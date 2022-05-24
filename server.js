//denon run --allow-read --allow-write --allow-net --allow-env server.js
//https://arcane-shore-12026.herokuapp.com/
import { Application } from "https://deno.land/x/abc@v1.3.3/mod.ts";
import { abcCors } from "https://deno.land/x/cors/mod.ts";
import * as bcrypt from "https://deno.land/x/bcrypt/mod.ts";
import { v4 } from "https://deno.land/std@0.140.0/uuid/mod.ts";
import { Client } from "https://deno.land/x/postgres@v0.11.3/mod.ts";
import { config } from "https://deno.land/x/dotenv/mod.ts";

const DENO_ENV = Deno.env.get("DENO_ENV") ?? "development";

config({ path: `./.env.${DENO_ENV}`, export: true });

const wb = new Client(Deno.env.get("PG_WB_DB"));
await wb.connect();
const users = new Client(Deno.env.get("PG_USERS_DB"));
await users.connect();

const app = new Application();
const PORT = Number(Deno.env.get("PORT"));
app
  // .get("/", async (server) => {
  //   return server.json({ response: "Backend deployed" });
  // })
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
  const isValidPassword = encryptedPassword === user.password;
  if (isValidPassword) {
    const sessionId = v4.generate();
    await users.queryArray("INSERT INTO sessions (uuid, user_id, created_at) VALUES ($1, $2, current_timestamp)", sessionId, user.id);
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
