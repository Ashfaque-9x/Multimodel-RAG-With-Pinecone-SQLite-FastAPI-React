# Virtual Techbox — Persistent Multimodal PDF RAG

This project adapts the supplied `pdf-rag-chat-main` example's **FastAPI + Uvicorn + Docker + React 19 + Vite** structure to your existing multimodal RAG implementation. It replaces Qdrant with Pinecone while keeping the existing extraction, summarization, `MultiVectorRetriever`, history-aware retrieval, multimodal prompt, and LLM flow in `multimodel_rag.py`.

## What is preserved

- PDF parsing through `unstructured.partition.pdf` with high-resolution extraction, tables, and image payloads.
- Text, table, and image summaries created with the existing `ChatOpenAI` model.
- The existing OpenAI embedding model and model configuration from environment variables.
- `MultiVectorRetriever` with the original parent content stored in SQLite.
- History-aware retrieval and multimodal answer generation.
- Per-PDF chat history in SQLite, source metadata, retrieved images, PDF selection, clear-chat, and delete-PDF functionality.
- A React UI that offers PDF upload, a list of indexed PDFs, chat history, Markdown answers, retrieved images, and expandable source details.

## System Architecture

The following diagram illustrates the complete architecture of the
Multimodal PDF RAG application, including document ingestion,
semantic retrieval, SQLite persistence, and answer generation.

![Multimodal PDF RAG Architecture](assets/Multimodal%20PDF%20RAG%20Architecture.png)

## Project structure

```text
pinecone-multimodal-rag/
├── backend/
│   ├── app.py                  # FastAPI endpoints + CORS
│   ├── multimodel_rag.py       # Existing RAG flow, Pinecone vector-store adapter
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .dockerignore
│   └── .env.example            # Copy to .env and fill in secrets
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # React UI: upload, PDF list, chat, sources
│   │   ├── api.js              # FastAPI client
│   │   ├── main.jsx
│   │   └── index.css
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.js
│   └── .env.example
├── docker-compose.yml
├── .gitignore
└── README.md
```

## Pinecone and OpenAI environment variables

Create `backend/.env` by copying `backend/.env.example`. Keep this file private and **never commit it to GitHub**.

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_CHAT_MODEL=gpt-4.1-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=multimodal-rag
PINECONE_CLOUD=aws
PINECONE_REGION=us-east-1
PINECONE_METRIC=cosine

RAG_STORAGE_DIR=./rag_storage
SQLITE_DB_PATH=./rag_storage/rag_app.db
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

- `OPENAI_API_KEY`: used by the same `ChatOpenAI` and `OpenAIEmbeddings` classes as your existing RAG.
- `PINECONE_API_KEY`: create this in the Pinecone console.
- `PINECONE_INDEX_NAME`: one shared Pinecone index is used for all PDFs. The code creates it if absent.
- `PINECONE_CLOUD` / `PINECONE_REGION`: must be a serverless region supported by your Pinecone project. Change these if your Pinecone project uses a different region.
- `PINECONE_METRIC`: keep `cosine` for the current embedding setup.
- The index dimension is inferred from `OPENAI_EMBEDDING_MODEL`: `text-embedding-3-small` uses 1536 dimensions; `text-embedding-3-large` uses 3072. If you change to a different embedding model, update the dimension logic in `ensure_pinecone_index()` accordingly.

Each PDF's SHA-256 ID is used as a Pinecone **namespace**, isolating vector search between PDFs without creating one Pinecone index per document.

## Run locally (Windows PowerShell)

### 1. Configure backend

```powershell
cd backend
Copy-Item .env.example .env
# Edit .env and set OPENAI_API_KEY and PINECONE_API_KEY
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

API docs: <http://localhost:8000/docs>

The `unstructured` high-resolution PDF pipeline relies on native tools such as Poppler and Tesseract. On Windows, install them and make sure their executable directories are on `PATH`. The supplied Dockerfile installs the Linux packages automatically.

### 2. Configure frontend

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` requests to `http://localhost:8000`. For a separately hosted frontend, set `VITE_API_BASE_URL` in the frontend environment to the backend's public URL and add the frontend URL to backend `CORS_ORIGINS`.

## Run with Docker

Docker Compose starts the backend and the Vite development server. First create `backend/.env` as described above.

```bash
docker compose up --build
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:8000>
- Swagger docs: <http://localhost:8000/docs>

The `rag_storage` Docker volume persists the uploaded PDFs, extracted images, SQLite database, and chat history across container restarts. Pinecone stores vectors remotely.

To run only the backend image:

```bash
docker build -t virtual-techbox-rag ./backend
docker run --rm -p 8000:8000 --env-file backend/.env \
  -v rag_storage:/app/rag_storage virtual-techbox-rag
```

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Backend health |
| `GET` | `/api/pdfs` | List successfully indexed PDFs |
| `GET` | `/api/pdfs/{pdf_id}/messages` | Load saved chat for a PDF |
| `POST` | `/api/documents/upload` | Upload and index a PDF (`multipart/form-data`, field `file`) |
| `POST` | `/api/query` | Ask a question (`{"pdf_id":"…","question":"…"}`) |
| `DELETE` | `/api/pdfs/{pdf_id}/messages` | Clear one PDF's chat |
| `DELETE` | `/api/pdfs/{pdf_id}` | Delete PDF records/files and its Pinecone namespace |

## Deployment notes (Render or similar)

For a backend Web Service using Docker:
- Set the Dockerfile path/root directory to `backend` (depending on the hosting provider's settings).
- Add each variable from `backend/.env` in the host's Environment settings. **Do not upload the `.env` file to the hosting provider or commit it to the repository.**
- Set `CORS_ORIGINS` to the deployed frontend's exact origin, for example `https://your-frontend.example.com`.
- Mount a persistent disk/volume at `/app/rag_storage` if the host supports it; without persistent disk storage, SQLite chat history and original PDF/image content may be lost after redeploy/restart.
- Deploy the `frontend` as a static site using `npm run build` and publish `frontend/dist`, or host it separately. Set `VITE_API_BASE_URL` to the deployed backend base URL at build time.

## Important migration note

The old Qdrant vectors are **not copied** to Pinecone. The SQLite schema migration renames the stored vector-ID field, but Qdrant's actual vectors remain in Qdrant. Upload each PDF again after configuring Pinecone so its summaries are generated and indexed into the new Pinecone namespace. The original RAG pipeline flow and configured model names remain unchanged.

## Security / operational notes

- Keep both API keys server-side in `backend/.env` or your hosting provider's secret environment configuration. Do not put either key in `frontend/.env`.
- Add only trusted origins to `CORS_ORIGINS`.
- Large PDFs may take a while to process; the frontend and API allow a longer request timeout.
- Pinecone is a hosted service and requires outbound internet access from the backend.

[![Watch the video](https://img.youtube.com/vi/BLbvTOomzb0/maxresdefault.jpg)](https://www.youtube.com/watch?v=BLbvTOomzb0)
