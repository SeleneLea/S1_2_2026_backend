<#
.SYNOPSIS
  Revisa la integridad de un .EAP (Enterprise Architect 13.5) y resume sus diagramas.

.DESCRIPTION
  Detecta lo que hace que EA muestre diagramas vacios, lineas sueltas o elementos fantasma:
  referencias rotas entre t_diagramobjects / t_diagramlinks / t_connector / t_object / t_package,
  GUID repetidos, paquetes sin su fila en t_object, coordenadas con signo equivocado y DUID de
  lineas que no corresponden a ningun elemento del diagrama. Solo lee: no modifica el archivo.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File verificar-eap.ps1 -Archivo C:\docs\sistema.eap
#>
param(
  [Parameter(Mandatory = $true)][string]$Archivo,
  [switch]$SinResumen
)
$ErrorActionPreference = 'Stop'
if (-not [System.IO.Path]::IsPathRooted($Archivo)) { $Archivo = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Archivo)) }
if ([Environment]::Is64BitProcess) {
  $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
  $argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Archivo', $Archivo)
  if ($SinResumen) { $argumentos += '-SinResumen' }
  & $ps32 @argumentos
  exit $LASTEXITCODE
}
if (-not (Test-Path -LiteralPath $Archivo)) { Write-Host "ERROR: no existe $Archivo"; exit 2 }

$cn = New-Object System.Data.Odbc.OdbcConnection("Driver={Microsoft Access Driver (*.mdb)};Dbq=$Archivo;ReadOnly=1;")
$cn.Open()
function Tabla([string]$sql) {
  $da = New-Object System.Data.Odbc.OdbcDataAdapter($sql, $cn)
  $dt = New-Object System.Data.DataTable
  [void]$da.Fill($dt)
  return , $dt
}
$paquetes = Tabla 'SELECT Package_ID, Name, Parent_ID, ea_guid FROM t_package'
$objetos = Tabla 'SELECT Object_ID, Object_Type, Name, Package_ID, PDATA1, ea_guid, ParentID FROM t_object'
$diagramas = Tabla 'SELECT Diagram_ID, Package_ID, Diagram_Type, Name, ea_guid FROM t_diagram'
$dobj = Tabla 'SELECT Diagram_ID, Object_ID, RectTop, RectLeft, RectRight, RectBottom, ObjectStyle FROM t_diagramobjects'
$dlink = Tabla 'SELECT DiagramID, ConnectorID, Style, Hidden FROM t_diagramlinks'
$conectores = Tabla 'SELECT Connector_ID, Connector_Type, Start_Object_ID, End_Object_ID, DiagramID, ea_guid FROM t_connector'
$cn.Close()

$errores = New-Object System.Collections.ArrayList
$avisos = New-Object System.Collections.ArrayList
function Error($m) { [void]$errores.Add($m) }
function Aviso($m) { [void]$avisos.Add($m) }

# Formato Jet: EA 13 y 13.5 abren los .EAP con Jet 3.5 salvo que se active 'Use JET 4.0' en sus opciones.
# Un archivo Jet 4 (por ejemplo, compactado sin Engine Type=4) da 'Unrecognized database format'.
$cabecera = New-Object byte[] 21
$flujo = [System.IO.File]::Open($Archivo, 'Open', 'Read', 'ReadWrite')
[void]$flujo.Read($cabecera, 0, 21); $flujo.Close()
if ($cabecera[20] -ne 0) {
  Error "el archivo esta en formato Jet 4 o superior (byte de version $($cabecera[20])): EA 13 y 13.5 por defecto responden 'Unrecognized database format'. Usa una base Jet 3 (como assets/plantilla-vacia.eap) o activa en EA Tools > Options > General > Use JET 4.0."
}

$pkgIds = @{}; foreach ($p in $paquetes.Rows) { $pkgIds[[int]$p.Package_ID] = $p }
$objIds = @{}; foreach ($o in $objetos.Rows) { $objIds[[int]$o.Object_ID] = $o }
$diagIds = @{}; foreach ($d in $diagramas.Rows) { $diagIds[[int]$d.Diagram_ID] = $d }
$conIds = @{}; foreach ($c in $conectores.Rows) { $conIds[[int]$c.Connector_ID] = $c }

function Repetidos($tabla, $nombre) {
  $vistos = @{}
  foreach ($f in $tabla.Rows) {
    $g = [string]$f.ea_guid
    if (-not $g) { continue }
    if ($vistos.ContainsKey($g)) { Error "$nombre con ea_guid repetido $g" } else { $vistos[$g] = $true }
  }
}
Repetidos $objetos 't_object'
Repetidos $diagramas 't_diagram'
Repetidos $conectores 't_connector'

$guidPaquetes = @{}; foreach ($p in $paquetes.Rows) { $guidPaquetes[[string]$p.ea_guid] = [int]$p.Package_ID }
foreach ($p in $paquetes.Rows) {
  if ([int]$p.Parent_ID -ne 0 -and -not $pkgIds.ContainsKey([int]$p.Parent_ID)) { Error "paquete '$($p.Name)' con Parent_ID inexistente $($p.Parent_ID)" }
}
$objPaquete = @{}
foreach ($o in $objetos.Rows) {
  if (-not $pkgIds.ContainsKey([int]$o.Package_ID)) { Error "elemento '$($o.Name)' ($($o.Object_Type)) en paquete inexistente $($o.Package_ID)" }
  if ([int]$o.ParentID -ne 0 -and -not $objIds.ContainsKey([int]$o.ParentID)) { Error "elemento '$($o.Name)' con ParentID inexistente $($o.ParentID)" }
  if ($o.Object_Type -eq 'Package') {
    $objPaquete[[string]$o.ea_guid] = $true
    $idPaquete = 0
    if (-not [int]::TryParse([string]$o.PDATA1, [ref]$idPaquete) -or -not $pkgIds.ContainsKey($idPaquete)) { Error "t_object del paquete '$($o.Name)' con PDATA1 '$($o.PDATA1)' que no es un Package_ID" }
    elseif ([string]$pkgIds[$idPaquete].ea_guid -ne [string]$o.ea_guid) { Error "paquete '$($o.Name)': el ea_guid de t_object no coincide con el de t_package" }
  }
  if (@('InteractionFragment', 'UMLDiagram') -contains [string]$o.Object_Type) {
    $did = 0
    if (-not [int]::TryParse([string]$o.PDATA1, [ref]$did) -or -not $diagIds.ContainsKey($did)) { Aviso "$($o.Object_Type) '$($o.Name)' apunta a un diagrama inexistente (PDATA1=$($o.PDATA1))" }
  }
}
foreach ($p in $paquetes.Rows) {
  if ([int]$p.Parent_ID -ne 0 -and -not $objPaquete.ContainsKey([string]$p.ea_guid)) { Error "paquete '$($p.Name)' sin su fila en t_object (EA no lo mostraria como elemento)" }
}
foreach ($d in $diagramas.Rows) {
  if (-not $pkgIds.ContainsKey([int]$d.Package_ID)) { Error "diagrama '$($d.Name)' en paquete inexistente $($d.Package_ID)" }
}

$duids = @{}
$enDiagrama = @{}
foreach ($x in $dobj.Rows) {
  $did = [int]$x.Diagram_ID; $oid = [int]$x.Object_ID
  if (-not $diagIds.ContainsKey($did)) { Error "t_diagramobjects en diagrama inexistente $did"; continue }
  if (-not $objIds.ContainsKey($oid)) { Error "diagrama '$($diagIds[$did].Name)': ubica un elemento inexistente $oid"; continue }
  $enDiagrama[$oid] = $true
  if ([int]$x.RectTop -gt 0 -or [int]$x.RectBottom -gt [int]$x.RectTop -or [int]$x.RectRight -lt [int]$x.RectLeft) {
    Aviso "diagrama '$($diagIds[$did].Name)': '$($objIds[$oid].Name)' con rectangulo invertido (Top=$($x.RectTop) Bottom=$($x.RectBottom); en EA la Y va en negativo)"
  }
  if ([string]$x.ObjectStyle -match 'DUID=([0-9A-Fa-f]+);') { $duids["$did|$($Matches[1])"] = $true }
}
foreach ($c in $conectores.Rows) {
  if (-not $objIds.ContainsKey([int]$c.Start_Object_ID)) { Error "conector $($c.Connector_ID) ($($c.Connector_Type)) con origen inexistente" }
  if (-not $objIds.ContainsKey([int]$c.End_Object_ID)) { Error "conector $($c.Connector_ID) ($($c.Connector_Type)) con destino inexistente" }
  if ($c.Connector_Type -eq 'Sequence' -and -not $diagIds.ContainsKey([int]$c.DiagramID)) { Error "mensaje $($c.Connector_ID) sin diagrama de secuencia (DiagramID=$($c.DiagramID))" }
}
foreach ($l in $dlink.Rows) {
  $did = [int]$l.DiagramID; $cid = [int]$l.ConnectorID
  if (-not $diagIds.ContainsKey($did)) { Error "t_diagramlinks en diagrama inexistente $did"; continue }
  if (-not $conIds.ContainsKey($cid)) { Error "diagrama '$($diagIds[$did].Name)': linea de un conector inexistente $cid"; continue }
  foreach ($k in 'SOID', 'EOID') {
    if ([string]$l.Style -match "$k=([0-9A-Fa-f]*);") {
      if ($Matches[1] -and -not $duids.ContainsKey("$did|$($Matches[1])")) { Aviso "diagrama '$($diagIds[$did].Name)': la linea del conector $cid tiene $k=$($Matches[1]) que no es un DUID del diagrama" }
    }
  }
}
$sueltos = @($objetos.Rows | Where-Object { -not $enDiagrama.ContainsKey([int]$_.Object_ID) -and @('Package', 'Trigger') -notcontains [string]$_.Object_Type })
if ($sueltos.Count) { Aviso "$($sueltos.Count) elemento(s) no aparecen en ningun diagrama (solo en el Project Browser)" }

function Ruta($id) {
  $partes = @()
  $p = $pkgIds[[int]$id]
  while ($p) { $partes = , [string]$p.Name + $partes; $p = $pkgIds[[int]$p.Parent_ID] }
  return ($partes -join ' / ')
}
if (-not $SinResumen) {
  Write-Host "Diagramas de $Archivo"
  $lineas = @{}; foreach ($l in $dlink.Rows) { if (-not [bool]$l.Hidden) { $lineas[[int]$l.DiagramID] = 1 + [int]$lineas[[int]$l.DiagramID] } }
  $objs = @{}; foreach ($x in $dobj.Rows) { $objs[[int]$x.Diagram_ID] = 1 + [int]$objs[[int]$x.Diagram_ID] }
  $msgs = @{}; foreach ($c in $conectores.Rows) { if ($c.Connector_Type -eq 'Sequence') { $msgs[[int]$c.DiagramID] = 1 + [int]$msgs[[int]$c.DiagramID] } }
  foreach ($d in ($diagramas.Rows | Sort-Object { Ruta $_.Package_ID }, Name)) {
    $id = [int]$d.Diagram_ID
    $extra = ''
    if ($msgs[$id]) { $extra = ", $($msgs[$id]) mensajes" }
    Write-Host ("  [{0}] {1} / {2}: {3} elementos, {4} lineas{5}" -f $d.Diagram_Type, (Ruta $d.Package_ID), $d.Name, [int]$objs[$id], [int]$lineas[$id], $extra)
  }
}
Write-Host ("Resultado: {0} error(es), {1} aviso(s)" -f $errores.Count, $avisos.Count)
foreach ($e in $errores) { Write-Host "  ERROR: $e" }
foreach ($a in ($avisos | Select-Object -First 40)) { Write-Host "  aviso: $a" }
if ($avisos.Count -gt 40) { Write-Host "  ... y $($avisos.Count - 40) aviso(s) mas" }
if ($errores.Count) { exit 1 } else { exit 0 }
