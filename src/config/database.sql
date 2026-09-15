CREATE TABLE "Users" (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  eliminar BOOLEAN DEFAULT false NOT NULL,
  createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Salas" (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  xml TEXT,
  description TEXT,
  eliminar BOOLEAN DEFAULT false NOT NULL,
  userId INT NOT NULL,
  createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES "Users" (id) ON DELETE CASCADE
);

CREATE TABLE "Usersala" (
  id SERIAL PRIMARY KEY,
  userId INT NOT NULL,
  salas_id INT NOT NULL,
  FOREIGN KEY (userId) REFERENCES "Users" (id) ON DELETE CASCADE,
  FOREIGN KEY (salas_id) REFERENCES "Salas" (id) ON DELETE CASCADE,
  UNIQUE (userId, salas_id)
);

    -- Metodos

    -- Para crear nuevo usuario
CREATE OR REPLACE FUNCTION create_user_if_not_exists(
    p_name VARCHAR,
    p_email VARCHAR,
    p_password VARCHAR
)
RETURNS TABLE (
    user_id INT,
    user_name VARCHAR,
    user_email VARCHAR,
    user_password VARCHAR
) AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Users" WHERE email = p_email AND eliminar = false) THEN
        RETURN;
    ELSIF EXISTS (SELECT 1 FROM "Users" WHERE email = p_email AND eliminar = true) THEN
        RETURN QUERY
        UPDATE "Users"
        SET name = p_name, password = p_password, updatedAt = CURRENT_TIMESTAMP, eliminar = false
        WHERE email = p_email
        RETURNING id, name, email, password;
    ELSE
        RETURN QUERY
        INSERT INTO "Users" (name, email, password)
        VALUES (p_name, p_email, p_password)
        RETURNING id, name, email, password;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_User(p_id INT)
RETURNS VOID AS $$
BEGIN
    UPDATE "Users"
    SET eliminar = true, updatedAt = CURRENT_TIMESTAMP
    WHERE id = p_id AND eliminar = false;

    IF NOT FOUND THEN
        RAISE NOTICE 'No se encontró ningún usuario con el id % o el atributo "eliminar" ya estaba en true.', p_id;
    END IF;
END;
$$ LANGUAGE plpgsql;
