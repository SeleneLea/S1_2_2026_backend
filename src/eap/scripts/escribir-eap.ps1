<#
.SYNOPSIS
  Ejecuta un plan de preparar-plan.mjs y deja un .EAP de Enterprise Architect 13.5 con los diagramas dibujados.

.DESCRIPTION
  Copia el .EAP base (por defecto assets\plantilla-vacia.eap) al archivo de salida y ejecuta los pasos del
  plan dentro de una transaccion ODBC: busca/crea paquetes, crea diagramas, elementos, su ubicacion en el
  lienzo, relaciones, lineas y mensajes. El archivo base NUNCA se modifica.

  Necesita el driver ODBC de Access de 32 bits ("Microsoft Access Driver (*.mdb)"), que viene con Windows.
  Si se ejecuta en PowerShell de 64 bits, el script se relanza solo en el de 32 bits.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File escribir-eap.ps1 -Plan plan.json -Salida C:\docs\sistema.eap

.EXAMPLE
  # Agregar diagramas a una COPIA de un proyecto existente
  powershell -ExecutionPolicy Bypass -File escribir-eap.ps1 -Plan plan.json -Base "C:\docs\proyecto.EAP" -Salida "C:\docs\proyecto-con-diagramas.EAP"
#>
param(
  [Parameter(Mandatory = $true)][string]$Plan,
  [Parameter(Mandatory = $true)][string]$Salida,
  [string]$Base,
  [switch]$Sobrescribir
)
$ErrorActionPreference = 'Stop'

function Ruta-Completa([string]$ruta) {
  if ([System.IO.Path]::IsPathRooted($ruta)) { return [System.IO.Path]::GetFullPath($ruta) }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $ruta))
}
$Plan = Ruta-Completa $Plan
$Salida = Ruta-Completa $Salida
if (-not $Base) { $Base = Join-Path $PSScriptRoot '..\assets\plantilla-vacia.eap' }
$Base = Ruta-Completa $Base

# El driver de Access para .mdb/.eap solo existe en 32 bits
if ([Environment]::Is64BitProcess) {
  $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
  $argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Plan', $Plan, '-Salida', $Salida, '-Base', $Base)
  if ($Sobrescribir) { $argumentos += '-Sobrescribir' }
  & $ps32 @argumentos
  exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $Plan)) { Write-Host "ERROR: no existe el plan $Plan"; exit 2 }
if (-not (Test-Path -LiteralPath $Base)) { Write-Host "ERROR: no existe el .EAP base $Base"; exit 2 }
if ($Salida -ieq $Base) { Write-Host 'ERROR: la salida no puede ser el mismo archivo base (se trabaja siempre sobre una copia).'; exit 2 }
if ((Test-Path -LiteralPath $Salida) -and -not $Sobrescribir) { Write-Host "ERROR: ya existe $Salida (usa -Sobrescribir para reemplazarlo)"; exit 2 }

$planJson = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
Copy-Item -LiteralPath $Base -Destination $Salida -Force

$driver = 'Microsoft Access Driver (*.mdb)'
$disponibles = @(Get-OdbcDriver -Platform 32-bit -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*(*.mdb*' } | ForEach-Object Name)
if ($disponibles.Count -and $disponibles -notcontains $driver) { $driver = $disponibles[0] }
$cn = New-Object System.Data.Odbc.OdbcConnection("Driver={$driver};Dbq=$Salida;")
try { $cn.Open() } catch { Write-Host "ERROR: no se pudo abrir $Salida con el driver ODBC de Access de 32 bits. Esta EA abierto con ese archivo? $($_.Exception.Message)"; exit 3 }

$tx = $null
# Diccionarios que distinguen mayusculas: "obj:Funcionario" (clase) y "obj:funcionario" (actor) son distintos
$ids = New-Object 'System.Collections.Generic.Dictionary[string,int]'       # clave -> id numerico
$guids = New-Object 'System.Collections.Generic.Dictionary[string,string]'  # clave -> ea_guid
$nuevos = New-Object 'System.Collections.Generic.Dictionary[string,bool]'   # claves insertadas en esta ejecucion
$esquemas = @{}
$contador = @{}
$reutilizados = 0

function Obtener-Esquema([string]$tabla) {
  # El driver de Access no implementa GetSchema('Columns'): se leen los tipos de una consulta vacia
  if (-not $esquemas.ContainsKey($tabla)) {
    $cols = @{}
    $cmd = Nuevo-Comando "SELECT * FROM [$tabla] WHERE 1 = 0"
    $lector = $cmd.ExecuteReader()
    try {
      for ($i = 0; $i -lt $lector.FieldCount; $i++) {
        $cols[$lector.GetName($i).ToLower()] = @{ nombre = $lector.GetName($i); tipo = $lector.GetDataTypeName($i).ToUpper() }
      }
    } finally { $lector.Close(); $cmd.Dispose() }
    if ($cols.Count -eq 0) { throw "La tabla $tabla no existe en el .EAP" }
    $esquemas[$tabla] = $cols
  }
  return $esquemas[$tabla]
}

function Resolver($valor) {
  if ($valor -is [System.Management.Automation.PSCustomObject]) {
    $props = $valor.PSObject.Properties
    if ($props['ref']) { $k = [string]$valor.ref; if (-not $ids.ContainsKey($k)) { throw "Referencia sin resolver: $k" }; return [int]$ids[$k] }
    if ($props['refTexto']) { $k = [string]$valor.refTexto; if (-not $ids.ContainsKey($k)) { throw "Referencia sin resolver: $k" }; return [string]$ids[$k] }
    if ($props['guidDe']) { $k = [string]$valor.guidDe; if (-not $guids.ContainsKey($k)) { throw "GUID sin resolver: $k" }; return [string]$guids[$k] }
    if ($props['fecha']) { $n = Get-Date; return (New-Object DateTime $n.Year, $n.Month, $n.Day, $n.Hour, $n.Minute, $n.Second) }
    throw "Valor especial desconocido: $($valor | ConvertTo-Json -Compress)"
  }
  return $valor
}

function A-Booleano($v) {
  if ($v -is [bool]) { return $v }
  if ($v -is [string]) { return @('1', 'true', '-1', 'si', 'yes') -contains $v.ToLower() }
  return [double]$v -ne 0
}

function Agregar-Parametro($cmd, $col, $valor) {
  $p = $cmd.CreateParameter()
  $tipo = $col.tipo
  if ($null -eq $valor) {
    $p.OdbcType = [System.Data.Odbc.OdbcType]::VarChar
    $p.Value = [DBNull]::Value
  } elseif ($tipo -eq 'BIT') {
    $p.OdbcType = [System.Data.Odbc.OdbcType]::Bit; $p.Value = [bool](A-Booleano $valor)
  } elseif (@('INTEGER', 'SMALLINT', 'BYTE', 'TINYINT', 'COUNTER', 'LONG') -contains $tipo) {
    $p.OdbcType = [System.Data.Odbc.OdbcType]::Int
    if ($valor -is [bool]) { $p.Value = [int]$valor } else { $p.Value = [int][double]$valor }
  } elseif ($tipo -eq 'DATETIME') {
    $p.OdbcType = [System.Data.Odbc.OdbcType]::DateTime; $p.Value = [datetime]$valor
  } elseif (@('REAL', 'DOUBLE', 'FLOAT', 'CURRENCY', 'NUMERIC', 'DECIMAL') -contains $tipo) {
    $p.OdbcType = [System.Data.Odbc.OdbcType]::Double; $p.Value = [double]$valor
  } elseif (@('LONGCHAR', 'LONGTEXT', 'MEMO') -contains $tipo) {
    $p.OdbcType = [System.Data.Odbc.OdbcType]::NText; $p.Value = [string]$valor
  } else {
    $p.OdbcType = [System.Data.Odbc.OdbcType]::NVarChar; $p.Value = [string]$valor
  }
  [void]$cmd.Parameters.Add($p)
}

function Nuevo-Comando([string]$sql) {
  $cmd = $cn.CreateCommand()
  $cmd.Transaction = $tx
  $cmd.CommandText = $sql
  return $cmd
}

function Registrar-Id($paso, $tabla, $guid) {
  $esquema = Obtener-Esquema $tabla
  $colId = $esquema[([string]$paso.columnaId).ToLower()].nombre
  $cmd = Nuevo-Comando "SELECT [$colId] FROM [$tabla] WHERE [ea_guid] = ?"
  Agregar-Parametro $cmd $esquema['ea_guid'] $guid
  try { $id = $cmd.ExecuteScalar() } finally { $cmd.Dispose() }
  if ($null -eq $id -or $id -is [DBNull]) { throw "No se encontro la fila recien insertada en $tabla ($guid)" }
  $ids[[string]$paso.clave] = [int]$id
  $guids[[string]$paso.clave] = [string]$guid
}

function Paso-Insertar($paso) {
  $tabla = [string]$paso.tabla
  $esquema = Obtener-Esquema $tabla
  $cols = New-Object System.Collections.ArrayList
  $vals = New-Object System.Collections.ArrayList
  foreach ($prop in $paso.valores.PSObject.Properties) {
    $col = $esquema[$prop.Name.ToLower()]
    if (-not $col) { throw "La columna $($prop.Name) no existe en $tabla" }
    if ($col.tipo -eq 'COUNTER') { continue }
    [void]$cols.Add($col)
    [void]$vals.Add((Resolver $prop.Value))
  }
  $nombres = ($cols | ForEach-Object { "[$($_.nombre)]" }) -join ', '
  $marcas = (@('?') * $cols.Count) -join ', '
  $cmd = Nuevo-Comando "INSERT INTO [$tabla] ($nombres) VALUES ($marcas)"
  for ($i = 0; $i -lt $cols.Count; $i++) { Agregar-Parametro $cmd $cols[$i] $vals[$i] }
  try { [void]$cmd.ExecuteNonQuery() } finally { $cmd.Dispose() }
  $contador[$tabla] = 1 + [int]$contador[$tabla]
  if ($paso.clave) {
    $guid = Resolver $paso.valores.ea_guid
    Registrar-Id $paso $tabla $guid
    $nuevos[[string]$paso.clave] = $true
  }
}

function Paso-Buscar($paso, [switch]$SoloAvisar) {
  $tabla = [string]$paso.tabla
  $esquema = Obtener-Esquema $tabla
  $condiciones = @()
  $parametros = New-Object System.Collections.ArrayList
  foreach ($prop in $paso.donde.PSObject.Properties) {
    $col = $esquema[$prop.Name.ToLower()]
    if (-not $col) { throw "La columna $($prop.Name) no existe en $tabla" }
    $v = Resolver $prop.Value
    if ($null -eq $v) { $condiciones += "[$($col.nombre)] IS NULL" }
    else { $condiciones += "[$($col.nombre)] = ?"; [void]$parametros.Add(@($col, $v)) }
  }
  $colId = $esquema[([string]$paso.columnaId).ToLower()].nombre
  $sqlGuid = ''
  if ($paso.columnaGuid) { $sqlGuid = ", [ea_guid]" }
  $cmd = Nuevo-Comando ("SELECT TOP 1 [$colId]$sqlGuid FROM [$tabla] WHERE " + ($condiciones -join ' AND ') + " ORDER BY [$colId]")
  foreach ($par in $parametros) { Agregar-Parametro $cmd $par[0] $par[1] }
  $lector = $cmd.ExecuteReader()
  try {
    if ($lector.Read()) {
      if ($SoloAvisar) { Write-Host "  aviso: $($paso.mensaje)"; return }
      $ids[[string]$paso.clave] = [int]$lector[0]
      if ($paso.columnaGuid) { $guids[[string]$paso.clave] = [string]$lector[1] }
      if ($tabla -ne 't_package' -or $paso.clave -ne 'pkg:') { $script:reutilizados++ }
    } elseif ($paso.obligatorio -and -not $SoloAvisar) {
      throw "No se encontro $($paso.descripcion) en el .EAP base"
    }
  } finally { $lector.Close(); $cmd.Dispose() }
}

function Paso-OcultarNoListados($paso) {
  $diagrama = $ids[[string]$paso.diagrama]
  $duid = @{}
  $cmd = Nuevo-Comando 'SELECT [Object_ID], [ObjectStyle] FROM [t_diagramobjects] WHERE [Diagram_ID] = ?'
  Agregar-Parametro $cmd @{ tipo = 'INTEGER' } $diagrama
  $lector = $cmd.ExecuteReader()
  while ($lector.Read()) {
    $estilo = [string]$lector[1]
    if ($estilo -match 'DUID=([0-9A-Fa-f]+);') { $duid[[int]$lector[0]] = $Matches[1] }
  }
  $lector.Close(); $cmd.Dispose()
  $enlazados = @{}
  $cmd = Nuevo-Comando 'SELECT [ConnectorID] FROM [t_diagramlinks] WHERE [DiagramID] = ?'
  Agregar-Parametro $cmd @{ tipo = 'INTEGER' } $diagrama
  $lector = $cmd.ExecuteReader()
  while ($lector.Read()) { $enlazados[[int]$lector[0]] = $true }
  $lector.Close(); $cmd.Dispose()
  $cmd = Nuevo-Comando ('SELECT [Connector_ID], [Start_Object_ID], [End_Object_ID] FROM [t_connector] ' +
    'WHERE [Connector_Type] <> ''Sequence'' AND [Start_Object_ID] IN (SELECT [Object_ID] FROM [t_diagramobjects] WHERE [Diagram_ID] = ?) ' +
    'AND [End_Object_ID] IN (SELECT [Object_ID] FROM [t_diagramobjects] WHERE [Diagram_ID] = ?)')
  Agregar-Parametro $cmd @{ tipo = 'INTEGER' } $diagrama
  Agregar-Parametro $cmd @{ tipo = 'INTEGER' } $diagrama
  $ocultar = @()
  $lector = $cmd.ExecuteReader()
  while ($lector.Read()) { if (-not $enlazados.ContainsKey([int]$lector[0])) { $ocultar += , @([int]$lector[0], [int]$lector[1], [int]$lector[2]) } }
  $lector.Close(); $cmd.Dispose()
  foreach ($c in $ocultar) {
    $cmd = Nuevo-Comando 'INSERT INTO [t_diagramlinks] ([DiagramID], [ConnectorID], [Geometry], [Style], [Hidden]) VALUES (?, ?, ?, ?, ?)'
    Agregar-Parametro $cmd @{ tipo = 'INTEGER' } $diagrama
    Agregar-Parametro $cmd @{ tipo = 'INTEGER' } $c[0]
    Agregar-Parametro $cmd @{ tipo = 'LONGCHAR' } 'EDGE=2;$LLB=;LLT=;LMT=;LMB=;LRT=;LRB=;IRHS=;ILHS=;'
    Agregar-Parametro $cmd @{ tipo = 'VARCHAR' } ("Mode=3;EOID=" + $duid[$c[2]] + ";SOID=" + $duid[$c[1]] + ";Color=-1;LWidth=0;")
    Agregar-Parametro $cmd @{ tipo = 'BIT' } $true
    try { [void]$cmd.ExecuteNonQuery() } finally { $cmd.Dispose() }
    $contador['t_diagramlinks (ocultas)'] = 1 + [int]$contador['t_diagramlinks (ocultas)']
  }
}

$numero = 0
try {
  $tx = $cn.BeginTransaction()
  foreach ($paso in $planJson.pasos) {
    $numero++
    if ($paso.siNoExiste -and $ids.ContainsKey([string]$paso.siNoExiste)) { continue }
    if ($paso.soloSiNuevo -and -not $nuevos.ContainsKey([string]$paso.soloSiNuevo)) { continue }
    if ($paso.siAmbosExistentes) {
      $algunoNuevo = $false
      foreach ($k in $paso.siAmbosExistentes) { if ($nuevos.ContainsKey([string]$k) -or -not $ids.ContainsKey([string]$k)) { $algunoNuevo = $true } }
      if ($algunoNuevo) { continue }
    }
    switch ([string]$paso.accion) {
      'insertar' { Paso-Insertar $paso }
      'buscar' { Paso-Buscar $paso }
      'avisar' { Paso-Buscar $paso -SoloAvisar }
      'ocultarNoListados' { Paso-OcultarNoListados $paso }
      default { throw "Accion desconocida: $($paso.accion)" }
    }
  }
  $tx.Commit()
  $tx = $null
} catch {
  $detalle = $_.Exception.Message
  if ($tx) { try { $tx.Rollback() } catch { } }
  $cn.Close()
  Write-Host "ERROR en el paso $numero de $($planJson.pasos.Count): $detalle"
  if ($numero -gt 0 -and $numero -le $planJson.pasos.Count) { Write-Host ("  paso: " + ($planJson.pasos[$numero - 1] | ConvertTo-Json -Depth 6 -Compress)) }
  Write-Host "No se aplico ningun cambio (transaccion revertida). $Salida quedo igual que la base; puedes borrarlo."
  exit 1
}
$cn.Close()

Write-Host "Listo: $Salida"
foreach ($k in ($contador.Keys | Sort-Object)) { Write-Host ("  {0,-26} {1}" -f $k, $contador[$k]) }
if ($reutilizados) { Write-Host "  elementos/paquetes reutilizados del .EAP base: $reutilizados" }
Write-Host 'Abrelo en Enterprise Architect 13 / 13.5 (con EA cerrado mientras se escribe) y revisa el Project Browser.'
exit 0
