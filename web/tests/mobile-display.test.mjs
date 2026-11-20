import assert from "node:assert/strict";
import test from "node:test";
import { isLandscape, isMobileDisplay, startMobilePracticeFullscreen } from "../src/mobile-display.mjs";

function mobileBrowser() {
  const document = new EventTarget();
  document.documentElement = {};
  document.fullscreenElement = null;
  return {
    document, navigator: { userAgent: "Android" },
    matchMedia: () => ({ matches: false }), screen: { orientation: { type: "portrait-primary" } },
  };
}

test("mobile orientation follows the device even when the viewport is shortened", () => {
  const browser = mobileBrowser();
  assert.equal(isMobileDisplay(browser), true);
  assert.equal(isLandscape(browser, { matches: true }), false);
  browser.screen.orientation.type = "landscape-secondary";
  assert.equal(isLandscape(browser, { matches: false }), true);
  delete browser.screen.orientation;
  browser.orientation = -90;
  assert.equal(isLandscape(browser, { matches: false }), true);
  delete browser.orientation;
  assert.equal(isLandscape(browser, { matches: true }), true);
  browser.navigator.userAgent = "Desktop";
  assert.equal(isMobileDisplay(browser), false);
  browser.navigator = { userAgent: "Macintosh", maxTouchPoints: 5 };
  assert.equal(isMobileDisplay(browser), true);
});

test("mobile practice requests fullscreen immediately, locks portrait, and exits its own session", async () => {
  const browser = mobileBrowser();
  const { document } = browser;
  const root = document.documentElement;
  const operations = [];
  root.requestFullscreen = async () => {
    operations.push("request");
    document.fullscreenElement = root;
  };
  document.exitFullscreen = async () => { operations.push("exit"); };
  browser.screen.orientation.lock = async type => { operations.push(type); };
  const close = startMobilePracticeFullscreen(browser);
  assert.deepEqual(operations, ["request"]);
  await Promise.resolve();
  assert.deepEqual(operations, ["request", "portrait"]);
  close();
  assert.deepEqual(operations, ["request", "portrait", "exit"]);
  assert.equal(startMobilePracticeFullscreen(browser), undefined);
  document.fullscreenElement = null;
  browser.navigator.userAgent = "Desktop";
  assert.equal(startMobilePracticeFullscreen(browser), undefined);
});

test("leaving practice during a fullscreen request exits after it resolves", async () => {
  const browser = mobileBrowser();
  const { document } = browser;
  const root = document.documentElement;
  const operations = [];
  const requested = Promise.withResolvers();
  root.requestFullscreen = () => requested.promise;
  document.exitFullscreen = async () => { operations.push("exit"); };
  browser.screen.orientation.lock = async () => { operations.push("lock"); };
  startMobilePracticeFullscreen(browser)();
  document.fullscreenElement = root;
  requested.resolve();
  await requested.promise;
  assert.deepEqual(operations, ["exit"]);
});

test("a browser denial leaves practice usable and does not exit another fullscreen element", async () => {
  const browser = mobileBrowser();
  const { document } = browser;
  const requested = Promise.withResolvers();
  document.documentElement.requestFullscreen = () => requested.promise;
  document.exitFullscreen = () => assert.fail("Should not exit fullscreen");
  const close = startMobilePracticeFullscreen(browser);
  requested.reject(new Error("Fullscreen unavailable"));
  await requested.promise.catch(() => {});
  document.fullscreenElement = {};
  close();
});
