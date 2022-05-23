import { DB } from "https://deno.land/x/sqlite/mod.ts";

// try {

// } catch {
//   // nothing to remove
// }

const db = new DB("./users.db");

await db.query(
  `CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR NOT NULL,
        password VARCHAR NOT NULL,
        salt VARCHAR NOT NULL
    )`
);

await db.query(
  `CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
    )`
);
