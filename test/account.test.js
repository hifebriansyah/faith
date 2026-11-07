import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { avatarUrl, fetchUser, loginUrl, onSitus, signOut } from "../account/account.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const USER = { name: "Budi Santoso", email: "budi@contoh.id", picture: "https://lh3.googleusercontent.com/a/budi" };

test("the account button: our hosts only, the sign-in address returns to the page, only Google's photo addresses are used", () => {
  assert.ok(onSitus("situs.id") && onSitus("faith.situs.id") && onSitus("pro.situs.id"));
  for (const h of ["localhost", "127.0.0.1", "evilsitus.id", "situs.id.evil.com"]) assert.equal(onSitus(h), false, h);
  assert.equal(loginUrl("https://faith.situs.id/"), "https://auth.situs.id/login?return=https%3A%2F%2Ffaith.situs.id%2F");
  assert.equal(avatarUrl("https://lh3.googleusercontent.com/a/x"), "https://lh3.googleusercontent.com/a/x");
  for (const bad of ["https://evil.com/a.png", "http://lh3.googleusercontent.com/a", "javascript:alert(1)", "", null]) assert.equal(avatarUrl(bad), null, String(bad));
});

test("who is signed in comes from auth.situs.id with the cookie; a failure or a user without an email is nobody; signing out posts there", async () => {
  const calls = [];
  const ok = async (url, init = {}) => { calls.push([String(url), init.method ?? "GET", init.credentials]); return new Response(JSON.stringify({ user: USER }), { status: 200 }); };
  assert.deepEqual(await fetchUser(ok), USER);
  assert.deepEqual(calls[0], ["https://auth.situs.id/me", "GET", "include"]);
  assert.equal(await signOut(ok), true);
  assert.deepEqual(calls[1], ["https://auth.situs.id/logout", "POST", "include"]);
  assert.equal(await fetchUser(async () => { throw new Error("offline"); }), null);
  assert.equal(await fetchUser(async () => new Response("no", { status: 503 })), null);
  assert.equal(await fetchUser(async () => new Response(JSON.stringify({ user: { name: "x" } }))), null);
  assert.equal((await fetchUser(async () => new Response(JSON.stringify({ user: { ...USER, picture: "https://evil.com/x.png" } })))).picture, null);
});

test("the page mounts it before the theme button, and the site ships the module", () => {
  assert.match(html, /import\("\.\/account\/account\.js"\)/);
  assert.match(html, /account\.mount\(document\.getElementById\("theme"\)\)/);
  assert.match(html, /\.acct-menu \{ position: fixed/);
  assert.match(readFileSync(new URL("../.github/workflows/static.yml", import.meta.url), "utf8"), /cp -r personas icons account _site\//);
});
