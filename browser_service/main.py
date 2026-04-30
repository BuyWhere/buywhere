import asyncio
import base64
import json
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from playwright.async_api import async_playwright, Browser, Page, Error as PlaywrightError


class NavigateRequest(BaseModel):
    url: str
    timeout: int = 30000


class FillFormRequest(BaseModel):
    selector: str
    data: dict[str, str]


class ClickRequest(BaseModel):
    selector: str


class ScreenshotRequest(BaseModel):
    full_page: bool = False


class SubmitRequest(BaseModel):
    selector: str = "form"


class BrowserCommand(BaseModel):
    action: str
    params: dict[str, Any] = {}


browser: Browser | None = None
page: Page | None = None
lock = asyncio.Lock()


async def get_browser() -> Browser:
    global browser
    if browser is None or not browser.is_connected():
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
    return browser


async def get_page() -> Page:
    global browser, page
    br = await get_browser()
    if page is None:
        try:
            page = await br.new_page(viewport={"width": 1280, "height": 720})
        except Exception:
            page = await br.new_page(viewport={"width": 1280, "height": 720})
    return page


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    global browser, page
    if page:
        await page.close()
    if browser:
        await browser.close()


app = FastAPI(title="BuyWhere Browser Automation Service", lifespan=lifespan)


@app.post("/navigate")
async def navigate(req: NavigateRequest):
    async with lock:
        p = await get_page()
        try:
            response = await p.goto(req.url, timeout=req.timeout, wait_until="networkidle")
            return {
                "status": "ok",
                "url": p.url,
                "title": await p.title(),
                "status_code": response.status if response else None
            }
        except PlaywrightError as e:
            raise HTTPException(status_code=500, detail=f"Navigation failed: {e}")


@app.post("/fill")
async def fill_form(req: FillFormRequest):
    async with lock:
        p = await get_page()
        try:
            for field, value in req.data.items():
                await p.fill(req.selector.replace("{field}", field), value)
            return {"status": "ok", "fields_filled": list(req.data.keys())}
        except PlaywrightError as e:
            raise HTTPException(status_code=500, detail=f"Fill failed: {e}")


@app.post("/click")
async def click(req: ClickRequest):
    async with lock:
        p = await get_page()
        try:
            await p.click(req.selector, timeout=10000)
            await p.wait_for_load_state("networkidle")
            return {"status": "ok", "selector": req.selector}
        except PlaywrightError as e:
            raise HTTPException(status_code=500, detail=f"Click failed: {e}")


@app.post("/screenshot")
async def screenshot(req: ScreenshotRequest):
    async with lock:
        p = await get_page()
        try:
            img = await p.screenshot(full_page=req.full_page)
            return {
                "status": "ok",
                "image": base64.b64encode(img).decode(),
                "format": "png"
            }
        except PlaywrightError as e:
            raise HTTPException(status_code=500, detail=f"Screenshot failed: {e}")


@app.post("/submit")
async def submit(req: SubmitRequest):
    async with lock:
        p = await get_page()
        try:
            await p.click(req.selector)
            await p.wait_for_load_state("networkidle")
            return {"status": "ok", "url": p.url}
        except PlaywrightError as e:
            raise HTTPException(status_code=500, detail=f"Submit failed: {e}")


@app.post("/execute")
async def execute(command: BrowserCommand):
    async with lock:
        p = await get_page()
        try:
            if command.action == "navigate":
                r = await p.goto(command.params["url"], timeout=command.params.get("timeout", 30000))
                return {"status": "ok", "url": p.url, "status": r.status if r else None}
            elif command.action == "fill":
                for selector, value in command.params.get("fields", {}).items():
                    await p.fill(selector, value)
                return {"status": "ok"}
            elif command.action == "click":
                await p.click(command.params["selector"])
                await p.wait_for_load_state("networkidle")
                return {"status": "ok"}
            elif command.action == "screenshot":
                img = await p.screenshot(full_page=command.params.get("full_page", False))
                return {"status": "ok", "image": base64.b64encode(img).decode()}
            elif command.action == "evaluate":
                result = await p.evaluate(command.params["script"])
                return {"status": "ok", "result": result}
            else:
                raise HTTPException(status_code=400, detail=f"Unknown action: {command.action}")
        except PlaywrightError as e:
            raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok", "service": "browser-automation"}


@app.get("/")
async def root():
    return {
        "service": "BuyWhere Browser Automation",
        "endpoints": ["/navigate", "/fill", "/click", "/screenshot", "/submit", "/execute", "/health"]
    }
