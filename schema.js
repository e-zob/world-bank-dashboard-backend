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
    uuid TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at DATE NOT NULL
    )`
);

await db.query(
  `CREATE TABLE searches (
        search_id INTEGER PRIMARY KEY AUTOINCREMENT,
        country TEXT,
        indicator TEXT,
        year DATE
    )`
);

await db.query(
  `CREATE TABLE user_searches(
        user_id INTEGER NOT NULL,
        search_id INTEGER NOT NULL
    )`
);
