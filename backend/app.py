"""FastAPI API for the persistent multimodal RAG application."""
from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

from multimodel_rag import (
    BASE_STORAGE_DIR, PDF_STORAGE_DIR, SQLITE_PATH,
    build_multimodal_rag, load_multimodal_rag, rag_exists,
    get_available_pdfs, get_pdf_storage_paths, calculate_pdf_id,
    register_pdf, get_pdf_record, load_messages, load_chat_history,
    save_message, clear_chat, delete_pdf,
)

app = FastAPI(
    title="Virtual Techbox — Multimodal PDF RAG API",
    version="1.0.0",
    description="Persistent multimodal PDF RAG with Pinecone, SQLite, and OpenAI.",
)

origins = [x.strip() for x in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    pdf_id: str = Field(min_length=1)
    question: str = Field(min_length=1, max_length=10000)


def _ensure_openai_key() -> None:
    if not os.getenv("OPENAI_API_KEY", "").strip():
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured on the backend.")


@app.get("/")
def root():
    return {"message": "Multimodal RAG API is running", "docs": "/docs"}


@app.get("/api/health")
def health():
    return {"status": "ok", "vector_store": "Pinecone", "database": str(SQLITE_PATH)}


@app.get("/api/pdfs")
def list_pdfs():
    return {"pdfs": get_available_pdfs()}


@app.get("/api/pdfs/{pdf_id}/messages")
def get_messages(pdf_id: str):
    if not get_pdf_record(pdf_id):
        raise HTTPException(status_code=404, detail="PDF not found.")
    return {"messages": load_messages(pdf_id)}


@app.post("/api/documents/upload")
async def upload_pdf(file: UploadFile = File(...)):
    _ensure_openai_key()
    if not file.filename or Path(file.filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty.")
    # Basic PDF signature validation avoids accepting renamed non-PDF files.
    if not content[:1024].lstrip().startswith(b"%PDF-") and b"%PDF-" not in content[:1024]:
        raise HTTPException(status_code=400, detail="The uploaded file does not appear to be a valid PDF.")

    pdf_id = hashlib.sha256(content).hexdigest()
    stored_path, _namespace = get_pdf_storage_paths(pdf_id)
    stored_path.parent.mkdir(parents=True, exist_ok=True)
    if not stored_path.exists():
        stored_path.write_bytes(content)

    record = get_pdf_record(pdf_id)
    if record and record.get("status") == "completed" and rag_exists(pdf_id):
        return {
            "pdf_id": pdf_id, "filename": record["filename"], "status": "already_indexed",
            "message": "This PDF is already indexed.", "messages": load_messages(pdf_id),
        }

    try:
        register_pdf(pdf_id, file.filename, stored_path, "processing")
        await __import__("asyncio").to_thread(
            build_multimodal_rag, str(stored_path), pdf_id=pdf_id, filename=file.filename
        )
        return {
            "pdf_id": pdf_id, "filename": file.filename, "status": "completed",
            "message": "PDF extracted and indexed in Pinecone.", "messages": load_messages(pdf_id),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF processing failed: {exc}") from exc


@app.post("/api/query")
async def query_pdf(request: QueryRequest):
    _ensure_openai_key()
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be blank.")
    record = get_pdf_record(request.pdf_id)
    if not record or record.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Select or upload a successfully indexed PDF first.")
    try:
        chain = await __import__("asyncio").to_thread(load_multimodal_rag, request.pdf_id)
        history = load_chat_history(request.pdf_id)
        save_message(request.pdf_id, "user", question)
        response = await __import__("asyncio").to_thread(
            chain.invoke, {"input": question, "chat_history": history}
        )
        answer = response.get("answer", "") if isinstance(response, dict) else str(response)
        context = response.get("context", {}) if isinstance(response, dict) else {}
        images = context.get("images", []) or []
        sources = context.get("sources", []) or []
        save_message(request.pdf_id, "assistant", answer, images=images, sources=sources)
        return {"pdf_id": request.pdf_id, "answer": answer, "images": images, "sources": sources}
    except Exception as exc:
        # The user message is intentionally persisted for troubleshooting/retry continuity.
        raise HTTPException(status_code=500, detail=f"RAG query failed: {exc}") from exc


@app.delete("/api/pdfs/{pdf_id}/messages")
def clear_pdf_chat(pdf_id: str):
    if not get_pdf_record(pdf_id):
        raise HTTPException(status_code=404, detail="PDF not found.")
    clear_chat(pdf_id)
    return {"status": "ok", "message": "Chat history cleared."}


@app.delete("/api/pdfs/{pdf_id}")
def remove_pdf(pdf_id: str):
    if not get_pdf_record(pdf_id):
        raise HTTPException(status_code=404, detail="PDF not found.")
    try:
        delete_pdf(pdf_id)
        return {"status": "ok", "message": "PDF and its local records were deleted."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete PDF: {exc}") from exc
