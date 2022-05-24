import { Application } from "https://deno.land/x/abc@v1.3.3/mod.ts";
import { DB } from "https://deno.land/x/sqlite/mod.ts";
import { abcCors } from "https://deno.land/x/cors/mod.ts";
import * as bcrypt from "https://deno.land/x/bcrypt/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.11.3/mod.ts";

//denon run --allow-read --allow-write --allow-net --allow-env server.js

const wb = new Client("postgres://czreijar:TJ2StTuQIl2CoRoinQTwPxk8pBGfdf6t@kandula.db.elephantsql.com/czreijar");
await wb.connect();
const users = new Client("postgres://dzmurumb:6ZSO9Eo4oiMkZ-GOEYmkwt7fTOXpexW-@kesavan.db.elephantsql.com/dzmurumb");
await users.connect();

const app = new Application();
const PORT = 8080;
app
  .get("/hash/:pass", async (server) => {
    const { pass } = server.params;
    const salt = await bcrypt.genSalt();
    const encryptedPassword = await bcrypt.hash(pass, salt);
    return server.json(encryptedPassword);
  }) //to be deleted
  .post("/sessions", logIn)
  .post("/users", createAccount)
  .use(
    abcCors({
      origin: /^.+localhost:(3000|1234)$/,
      allowedHeaders: ["Authorization", "Content-Type", "Accept", "Origin", "User-Agent"],
      credentials: true,
    })
  )
  .start({ port: PORT });

console.log(`Server running on http://localhost:${PORT}`);

async function logIn(server) {
  const { username, password } = await server.body;
  const user = await getUser(username);
  if (!user) return server.json({ response: "User not found" }, 400);
  const encryptedPassword = await bcrypt.hash(password, user.salt);
  const isValidPassword = encryptedPassword === password;
  if (isValidPassword) {
    const sessionId = v4.generate();
    await users.queryArray("INSERT INTO sessions (uuid, user_id, created_at) VALUES (?, ?, datetime('now'))", [sessionId, user.id]);
    server.setCookie({
      name: "sessionId",
      value: sessionId,
    });
  }
  return isValidPassword ? server.json({ response: "Success" }, 200) : server.json({ response: "Invalid Password" }, 400);
}

async function createAccount(server) {
  const { username, password } = await server.body;
  const user = await getUser(username);
  if (user) return server.json({ response: "User already exists" }, 400);
  const salt = await bcrypt.genSalt();
  const encryptedPassword = await bcrypt.hash(password, salt);
  const query = `INSERT INTO users (username, password, salt) VALUES ($1,$2,$3)`;
  await users.queryArray(query, username, encryptedPassword, salt);
  return server.json({ response: "Success" }, 200);
}

async function getUser(username) {
  const query = `SELECT * FROM users WHERE username= $1`;
  const [user] = (await users.queryObject(query, username)).rows;
  return user;
}
