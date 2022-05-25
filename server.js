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
  .get("/allusers", async (server) => {
    const data = (await users.queryObject(`SELECT * FROM users`)).rows;
    return data;
  })
  .get("/", welcome)
  .post("/sessions", logIn)
  .delete("/sessions", logOut)
  .post("/users", createAccount)
  .delete("/users", deleteAccount) //testing only
  .get("/search", search)
  .use(
    abcCors({
      origin: /^.+localhost:(3000|1234)$/,
      allowedHeaders: ["Authorization", "Content-Type", "Accept", "Origin", "User-Agent"],
      credentials: true,
    })
  )
  .start({ port: PORT });

console.log(`Server running on http://localhost:${PORT}`);

async function welcome(server) {
  return server.json({ response: "Backend deployed" });
}

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

async function logOut(server) {
  const sessionId = server.cookies.sessionId;
  const query = `DELETE FROM sessions WHERE uuid = $1`;
  await users.queryArray(query, sessionId);
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

async function deleteAccount(server) {
  const { username } = await server.body;
  await users.queryArray("DELETE FROM users WHERE username=$1", username);
}

async function search(server) {
  const { countries, years, indicator } = await server.body;
  const isOneCountry = countries.length == 1;
  const isTwoCountries = countries.length == 2;
  const isAllTime = years.length == 0;
  const isOneYear = years.length == 1;
  const isYearRange = years.length == 2;
  if (isOneCountry && !indicator && isAllTime) getAllIndicatorsForCountryAllTime(countries[0]);
  if (isOneCountry && indicator && isAllTime) {
    const data = getIndicatorForCountryAllTime(countries[0], indicator);
    return Object.keys(data) == 0 ? server.json({ response: "Indicator or country doesn't exist" }, 404) : server.json({ response: data }, 200);
  }
}

async function getAllIndicatorsForCountryAllTime(country) {
  return;
}

async function getIndicatorForCountryAllTime(country, indicator) {
  const full_query = `SELECT year,value FROM indicators WHERE countrycode=(SELECT countrycode FROM countries WHERE shortname=${country} OR longname=${country}) AND IndicatorCode=(SELECT indicatorcode FROM series WHERE indicatorname=${indicator})`;
  const parameters = JSON.stringify({ 1: country, 2: country, 3: indicator });
  const query = `SELECT year,value FROM indicators WHERE countrycode=(SELECT countrycode FROM countries WHERE shortname=$1 OR longname=$2) AND IndicatorCode=(SELECT indicatorcode FROM series WHERE indicatorname=$3)`;
  const rawData = (await wb.queryObject(query, country, country, indicator)).rows;
  const data = { years: [], values: [] };
  rawData.forEach((obj) => {
    data.years.push(obj.year);
    data.values.push(obj.value);
  });
  const sessionId = server.cookies.sessionId;
  const currentUser = getCurrentUser(sessionId);
  await addSearch(full_query, indicator, query, parameters);
  const searchId = await getSearchId(full_query);
  await addHistory(currentUser, searchId);
  return data;
}

async function getUser(username) {
  const query = `SELECT * FROM users WHERE username= $1`;
  const [user] = (await users.queryObject(query, username)).rows;
  return user;
}

async function getCurrentUser(sessionId) {
  const query = `SELECT user_id FROM sessions WHERE uuid=$1`;
  const [user] = (await users.queryObject(query, sessionId)).rows;
  return user;
}

async function addSearch(full_query, search_title, p_query, params) {
  const search_id = getSearchId(full_query);
  if (!search_id) {
    query = `INSERT INTO searches (full_query, title, query, parameters) VALUES ($1, $2, $3, $4)`;
    await users.queryArray(query, full_query, search_title, p_query, params);
  }
}

async function getSearchId(full_query) {
  const query = `SELECT id FROM searches WHERE full_query= $1`;
  const [id] = (await users.queryObject(query, full_query)).rows;
  return id;
}

async function addHistory(user_id, search_id) {
  const query = `INSERT INTO history (user_id, search_id, created_at) VALUES ($1, $2, current_timestamp)`;
  await users.queryArray(query, user_id, search_id);
}
