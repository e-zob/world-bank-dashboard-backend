import { Application } from "https://deno.land/x/abc@v1.3.3/mod.ts";
import { DB } from "https://deno.land/x/sqlite/mod.ts";
import { abcCors } from "https://deno.land/x/cors/mod.ts";
import * as bcrypt from "https://deno.land/x/bcrypt/mod.ts";

const userdb = "./users.db";
const app = new Application();
const PORT = 8080;

app
  .post("./session", logIn)
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
  const query = `SELECT * FROM users WHERE username=?`;
  const [user] = userdb.query(query, [username]);
  if (!user) return server.json({ response: "User not found" }, 400);
  const encryptedPassword = await bcrypt.hash(password, user.salt);
  const isValidPassword = encryptedPassword === password;
  if (isValidPassword) {
    const sessionId = v4.generate();
    await userdb.query("INSERT INTO sessions (uuid, user_id, created_at) VALUES (?, ?, datetime('now'))", [sessionId, user.id]);
    server.setCookie({
      name: "sessionId",
      value: sessionId,
    });
  }
  return isValidPassword ? server.json({ response: "Success" }, 200) : server.json({ response: "Invalid Password" }, 400);
}
