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
const auth = "SigmaLabsXYZ";
app
  .get("/", welcome)
  .post("/sessions", logIn) //?admin=true
  .delete("/sessions", logOut) //
  .post("/users", createAccount) //?admin=true, authorisation=SigmaLabsXYZ
  .delete("/users", deleteAccount) //testing only
  .post("/search", search)

  .get("/history", getHistory) //?admin=true
  .get("search", getSearch) //?search_id=ASEARCHID

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
  return server.json({ response: "Welcome to world-bank-dashboard api, don't forget to deploy after every commit!" });
}

async function logIn(server) {
  const { username, password } = await server.body;
  const { admin, auth } = server.queryParams;
  const user = admin ? await getUser(username, True) : await getUser(username);
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
  const user = await getCurrentUser(sessionId);
  const query = `DELETE FROM sessions WHERE user_id = $1`;
  await users.queryArray(query, user);
}

async function createAccount(server) {
  const { username, password, auth } = await server.body;
  const { admin } = server.queryParams;
  let user = "";
  let table = "";
  if (admin) {
    if (auth !== auth) return server.json({ response: "Wrong authorization code" }, 400);
    user = await getUser(username, true);
    table = "admins";
  } else {
    user = await getUser(username);
    table = "users";
  }
  if (user) return server.json({ response: "User already exists" }, 400);
  const salt = await bcrypt.genSalt();
  const encryptedPassword = await bcrypt.hash(password, salt);
  const query = `INSERT INTO ${table} (username, password, salt) VALUES ($1,$2,$3)`;
  await users.queryArray(query, username, encryptedPassword, salt);
  return server.json({ response: "Success" }, 200);
}

async function deleteAccount(server) {
  const { username } = await server.body;
  await users.queryArray("DELETE FROM users WHERE username=$1", username);
  return server.json({ response: "Deleted successfully" }, 200);
}

async function search(server) {
  const { countries, years, indicator } = await server.body;
  const sessionId = server.cookies.sessionId;
  const currentUser = await getCurrentUser(sessionId);
  const successResponse = server.json({ response: "Search added successfully" }, 200);
  const { isOneCountry, isMultipleCountries, isAllTime, isOneYear, isYearRange } = getSearchOptions(countries, years, indicator);

  if (isYearRange) {
    await indicatorCountriesYearRange(currentUser, countries, indicator, years);
    return successResponse;
  }
  if (isAllTime) {
    await indicatorCountriesAllTime(currentUser, countries, indicator);
    return successResponse;
  }
  if (indicator && isOneYear) {
    await indicatorCountriesOneYear(currentUser, countries, indicator, years[0]);
    return successResponse;
  }
}

async function getHistory(server) {
  const { admin } = server.queryParams;
  const sessionId = server.cookies.sessionId;
  const currentUser = await getCurrentUser(sessionId);
  if (!currentUser) return server.json({ response: "Not logged in" }, 400);
  const condition = admin ? "" : " WHERE user_id=$1";
  const query = `SELECT history.*, searches.title, searches.info FROM history LEFT JOIN searches ON searches.id=history.search_id ${condition}`;
  const history = admin ? (await users.queryObject(query)).rows : (await users.queryObject(query, currentUser)).rows;
  return server.json({ response: history }, 200);
}

async function getSearch(server) {
  let { searchId } = await server.queryParams;
  const query = `SELECT query, parameters, info FROM searches WHERE id=$1`;
  if (!searchId) {
    const sessionId = server.cookies.sessionId;
    const currentUser = await getCurrentUser(sessionId);
    if (!currentUser) return server.json({ response: "Not logged in" }, 400);
    const history_query = `SELECT search_id, created_at FROM history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`;
    const [searchInfo] = (await users.queryObject(history_query, currentUser)).rows;
    if (!searchInfo) return server.json({ response: "No search by user" }, 404);
    searchId = searchInfo["search_id"];
  }
  const [searchDetails] = (await users.queryObject(query, searchId)).rows;
  if (!searchDetails) return server.json({ response: "Search not found" }, 404);
  const paramsInfo = searchDetails.parameters;
  const searchInfoCountries = searchDetails.info.countries.flat();
  const searchInfoIndicators = searchDetails.info.indicator;
  if (paramsInfo.length) {
    const data = {};
    for (let i = 0; i < paramsInfo.length; i++) {
      const params = Object.values(paramsInfo[i]);
      const result = (await wb.queryObject(searchDetails.query, ...params)).rows;
      data[searchInfoCountries[i]] = result;
    }
    return data.length === 0 ? server.json({ response: "Indicator or country doesn't exist" }, 404) : server.json({ response: data }, 200);
  }
  if (searchInfoIndicators) {
    const data = {};
    for (let i = 0; i < searchInfoIndicators.length; i++) {
      paramsInfo[3] = searchInfoIndicators[i].indicatorcode;
      const params = Object.values(paramsInfo);
      console.log(params);
      const result = (await wb.queryObject(searchDetails.query, ...params)).rows;
      data[searchInfoIndicators[i]] = result;
    }
    return data.length === 0 ? server.json({ response: "Indicator or country doesn't exist" }, 404) : server.json({ response: data }, 200);
  }
  const params = Object.values(paramsInfo);
  const data = (await wb.queryObject(searchDetails.query, ...params)).rows;
  return data.length === 0 ? server.json({ response: "Indicator or country doesn't exist" }, 404) : server.json({ response: data }, 200);
}

async function indicatorCountriesYearRange(currentUser, countries, indicator, years) {
  const full_query = `SELECT countryname, indicatorname, year,value FROM indicators WHERE countrycode = ANY (SELECT countrycode FROM countries WHERE shortname = ANY (${countries}) OR longname =ANY (${countries})) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname=${indicator}) AND year BETWEEN ${years[0]} AN ${years[1]}`;
  const query = `SELECT countryname, indicatorname, year,value FROM indicators WHERE countrycode = ANY(SELECT countrycode FROM countries WHERE shortname = ANY ($1) OR longname = ANY ($2)) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname=$3) AND year BETWEEN $4 AND $5`;
  const builtParams = [];
  for (const country of countries) {
    const obj = { 1: country, 2: country, 3: indicator, 4: years[0], 5: years[1] };
    builtParams.push(obj);
  }
  const parameters = JSON.stringify(builtParams);
  const info = JSON.stringify({ countries: countries, years: years });
  await updateSearchesHistoryTables(currentUser, full_query, indicator, info, query, parameters);
}

async function indicatorCountriesAllTime(currentUser, countries, indicator) {
  const full_query = `SELECT countryname, indicatorname, year,value FROM indicators WHERE countrycode=(SELECT countrycode FROM countries WHERE shortname=${countries} OR longname=${countries}) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname=${indicator})`;
  const query = `SELECT countryname, indicatorname, year,value FROM indicators WHERE countrycode=(SELECT countrycode FROM countries WHERE shortname=$1 OR longname=$2) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname=$3)`;
  const builtParams = [];
  for (const country of countries) {
    const obj = { 1: country, 2: country, 3: indicator };
    builtParams.push(obj);
  }
  const parameters = JSON.stringify(builtParams);
  if (!indicator) {
    const indicators_query = `SELECT DISTINCT(indicatorcode) FROM indicators WHERE countrycode =(SELECT countrycode FROM countries WHERE shortname = $1 OR longname = $2)`;
    const indicators = (await wb.queryObject(indicators_query, country, country)).rows;
    const info = JSON.stringify({ countries: countries, years: [], indicators: indicators });
    await updateSearchesHistoryTables(currentUser, full_query, "All Indicators", info, query, parameters);
  } else {
    const info = JSON.stringify({ countries: countries, years: [] });
    await updateSearchesHistoryTables(currentUser, full_query, indicator, info, query, parameters);
  }
}

async function indicatorCountriesOneYear(currentUser, countries, indicator, year) {
  const full_query = `SELECT countryname, indicatorname, year,value FROM indicators WHERE countrycode = ANY (SELECT countrycode FROM countries WHERE shortname = ANY (${countries}) OR longname =ANY (${countries})) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname=${indicator}) AND year=${year}`;
  const query = `SELECT countryname, indicatorname, year,value FROM indicators WHERE countrycode = ANY(SELECT countrycode FROM countries WHERE shortname = ANY ($1) OR longname = ANY ($2)) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname=$3) AND year=$4`;
  const parameters = JSON.stringify({ 1: countries, 2: countries, 3: indicator, 4: year });
  const info = JSON.stringify({ countries: [...countries], years: [year] });
  await updateSearchesHistoryTables(currentUser, full_query, indicator, info, query, parameters);
}
//SELECT countryname, year,value FROM indicators WHERE countrycode IN (SELECT countrycode FROM countries WHERE shortname IN ('Afghanistan', 'Arab World') OR longname IN ('Afghanistan', 'Arab World')) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname='Age dependency ratio, old (% of working-age population)');

function getSearchOptions(countries, years) {
  const isOneCountry = countries.length == 1;
  const isMultipleCountries = countries.length > 1;
  const isAllTime = years.length == 0;
  const isOneYear = years.length == 1;
  const isYearRange = years.length == 2;
  return { isOneCountry: isOneCountry, isMultipleCountries: isMultipleCountries, isAllTime: isAllTime, isOneYear: isOneYear, isYearRange: isYearRange };
}

async function updateSearchesHistoryTables(currentUser, full_query, indicator, info, query, parameters) {
  let searchId = await getSearchId(full_query);
  if (!searchId) {
    await addSearch(full_query, indicator, info, query, parameters);
    searchId = await getSearchId(full_query);
  }
  await addHistory(currentUser, searchId);
}

async function getUser(username, admin = false) {
  const query = admin ? `SELECT * FROM admins WHERE username= $1` : `SELECT * FROM admins WHERE username= $1`;
  const [user] = (await users.queryObject(query, username)).rows;
  return user;
}

async function getCurrentUser(sessionId) {
  const query = `SELECT user_id FROM sessions WHERE uuid=$1`;
  const [user] = (await users.queryObject(query, sessionId)).rows;

  return user ? user.user_id : user;
}

async function addSearch(full_query, title, info, search_query, parameters) {
  const search_id = await getSearchId(full_query);
  if (!search_id) {
    const query = `INSERT INTO searches (full_query, title,info, query, parameters) VALUES ($1, $2, $3, $4, $5)`;
    await users.queryArray(query, full_query, title, info, search_query, parameters);
  }
}

async function getSearchId(full_query) {
  const query = `SELECT id FROM searches WHERE full_query= $1`;
  const [id] = (await users.queryObject(query, full_query)).rows;
  return id ? id.id : id;
}

async function addHistory(user_id, search_id) {
  const query = `INSERT INTO history (user_id, search_id, created_at) VALUES ($1, $2, current_timestamp)`;
  await users.queryArray(query, user_id, search_id);
}

// SELECT countryname, year,value FROM indicators WHERE countrycode =(SELECT countrycode FROM countries WHERE shortname = 'Afghanistan' OR longname = 'Afghanistan') AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname='Age dependency ratio, old (% of working-age population)');
// FOR country IN (SELECT DISTINCT (countryname) FROM (SELECT countryname, year,value FROM indicators WHERE countrycode IN (SELECT countrycode FROM countries WHERE shortname IN ('Afghanistan', 'Arab World') OR longname IN ('Afghanistan', 'Arab World')) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname='Age dependency ratio, old (% of working-age population)')) AS search_countries) SELECT year,value FROM indicators WHERE countrycode=(SELECT countrycode FROM countries WHERE shortname=country OR longname=country) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname='Age dependency ratio, old (% of working-age population)');

// SELECT year,value FROM indicators WHERE countrycode=(SELECT countrycode FROM countries WHERE shortname=country OR longname=country) AND indicatorcode=(SELECT seriescode FROM series WHERE indicatorname='Age dependency ratio, old (% of working-age population)')
