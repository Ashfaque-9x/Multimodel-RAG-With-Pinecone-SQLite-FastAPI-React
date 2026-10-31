import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, getHealth, getPdfs, getMessages, uploadPdf, askQuestion, clearChat, deletePdf } from './api'

function App() {
  const [ready, setReady] = useState(false)
  const [healthError, setHealthError] = useState('')
  const [pdfs, setPdfs] = useState([])
  const [selectedPdf, setSelectedPdf] = useState('')
  const [messages, setMessages] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState(false)
  const [sourcesFor, setSourcesFor] = useState(null)
  const inputRef = useRef(null)
  const chatEndRef = useRef(null)
  const currentPdf = pdfs.find(p => p.pdf_id === selectedPdf)

  const refreshPdfs = useCallback(async () => {
    const items = await getPdfs()
    setPdfs(items)
    return items
  }, [])

  const selectPdf = useCallback(async (pdfId) => {
    setSelectedPdf(pdfId)
    setError('')
    setSourcesFor(null)
    if (!pdfId) { setMessages([]); return }
    try { setMessages(await getMessages(pdfId)) }
    catch (e) { setError(e.message); setMessages([]) }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer
    let attempts = 0
    const check = async () => {
      try {
        await getHealth()
        if (cancelled) return
        setReady(true); setHealthError('')
        const items = await refreshPdfs()
        if (!cancelled && items.length && !selectedPdf) await selectPdf(items[0].pdf_id)
      } catch {
        attempts += 1
        if (!cancelled) {
          setHealthError(attempts > 5 ? 'Backend may be starting up. Retrying…' : 'Connecting to backend…')
          timer = setTimeout(check, 2000)
        }
      }
    }
    check()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [refreshPdfs, selectPdf]) // selectedPdf is intentionally not a dependency: avoid repeated boot loading

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, asking])

  async function handleUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadStatus({ type: 'error', message: 'Please select a PDF file.' }); return
    }
    setUploading(true); setUploadStatus({ type: 'loading', message: `Processing ${file.name}. Extracting text, tables, and images…` }); setError('')
    try {
      const result = await uploadPdf(file)
      const items = await refreshPdfs()
      const found = items.find(p => p.pdf_id === result.pdf_id) || { pdf_id: result.pdf_id, filename: result.filename, status: 'completed' }
      setPdfs(old => old.some(p => p.pdf_id === found.pdf_id) ? old.map(p => p.pdf_id === found.pdf_id ? found : p) : [...items, found])
      setSelectedPdf(result.pdf_id)
      setMessages(result.messages || await getMessages(result.pdf_id))
      setUploadStatus({ type: 'success', message: result.status === 'already_indexed' ? `${result.filename} is already indexed.` : `${result.filename} was indexed successfully.` })
    } catch (e) {
      setUploadStatus({ type: 'error', message: e.message })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleAsk(event) {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || !selectedPdf || asking) return
    setMessages(prev => [...prev, { role: 'user', content: trimmed, images: [], sources: [] }])
    setQuestion(''); setAsking(true); setError('')
    try {
      const result = await askQuestion(selectedPdf, trimmed)
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer, images: result.images || [], sources: result.sources || [] }])
    } catch (e) {
      setError(e.message)
      // Refresh from SQLite to show exactly what was persisted.
      try { setMessages(await getMessages(selectedPdf)) } catch {}
    } finally { setAsking(false) }
  }

  async function handleClearChat() {
    if (!selectedPdf || !window.confirm('Clear chat history for this PDF?')) return
    setBusyAction(true)
    try { await clearChat(selectedPdf); setMessages([]); setSourcesFor(null) }
    catch (e) { setError(e.message) }
    finally { setBusyAction(false) }
  }

  async function handleDeletePdf() {
    if (!selectedPdf || !window.confirm(`Delete "${currentPdf?.filename || 'this PDF'}" and its index?`)) return
    setBusyAction(true)
    try {
      await deletePdf(selectedPdf)
      const remaining = await refreshPdfs()
      setSelectedPdf(''); setMessages([]); setSourcesFor(null)
      if (remaining.length) await selectPdf(remaining[0].pdf_id)
    } catch (e) { setError(e.message) }
    finally { setBusyAction(false) }
  }

  if (!ready) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-8 text-center max-w-sm">
        <div className="mx-auto mb-4 h-9 w-9 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
        <h2 className="font-semibold text-slate-800">Connecting to backend</h2>
        <p className="mt-2 text-sm text-slate-500">{healthError || 'Waking up server…'}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">📄 Multi-Modal RAG <span className="text-indigo-600">by Virtual Techbox</span></h1>
            <p className="mt-1 text-sm text-slate-500">Ask questions about your PDFs, including extracted tables and images.</p>
          </div>
          <span className="hidden sm:inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">API connected</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">📤 Upload a PDF</h2>
            <p className="mt-1 text-sm text-slate-500">Text, tables and images are extracted and indexed in Pinecone.</p>
            <label className={`mt-4 flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-slate-300 p-5 text-center hover:border-indigo-400 hover:bg-indigo-50 ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
              <span className="text-sm font-medium">{uploading ? 'Processing PDF…' : 'Choose a PDF file'}</span>
              <span className="mt-1 text-xs text-slate-400">PDF format only</span>
              <input ref={inputRef} type="file" accept=".pdf,application/pdf" onChange={handleUpload} disabled={uploading} className="hidden" />
            </label>
            {uploadStatus && <p className={`mt-3 text-sm ${uploadStatus.type === 'error' ? 'text-red-600' : uploadStatus.type === 'success' ? 'text-emerald-700' : 'text-slate-500'}`}>{uploadStatus.message}</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">📚 Your PDFs</h2>
              <button onClick={() => refreshPdfs().catch(e => setError(e.message))} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">Refresh</button>
            </div>
            {pdfs.length === 0 ? <p className="mt-3 text-sm text-slate-500">No processed PDFs yet. Upload one above.</p> : (
              <div className="mt-3 space-y-2">
                {pdfs.map(pdf => <button key={pdf.pdf_id} onClick={() => selectPdf(pdf.pdf_id)} className={`w-full rounded-lg border p-3 text-left text-sm transition ${selectedPdf === pdf.pdf_id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <span className="block break-words font-medium">{pdf.filename}</span>
                  <span className="mt-1 block text-xs text-slate-500">{pdf.status || 'completed'} · {pdf.pdf_id.slice(0, 10)}…</span>
                </button>)}
              </div>
            )}
            {selectedPdf && <div className="mt-4 grid grid-cols-1 gap-2">
              <button disabled={busyAction} onClick={handleClearChat} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">🧹 Clear current chat</button>
              <button disabled={busyAction} onClick={handleDeletePdf} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">🗑️ Delete current PDF</button>
            </div>}
          </section>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-xs leading-relaxed text-indigo-900">
            <strong>Storage:</strong> Pinecone stores searchable summaries in a namespace per PDF. SQLite persists original content, PDF metadata, and chat history on the backend disk.
          </div>
        </aside>

        <section className="flex min-h-[65vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold">💬 PDF conversation</h2>
            <p className="mt-1 truncate text-sm text-slate-500">{currentPdf ? `Current PDF: ${currentPdf.filename}` : 'Upload or select a PDF to start chatting.'}</p>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
            {!selectedPdf && <div className="py-16 text-center text-sm text-slate-500">Choose a PDF from the sidebar or upload a new one to begin.</div>}
            {selectedPdf && messages.length === 0 && <div className="py-14 text-center"><div className="text-4xl">📄</div><h3 className="mt-3 font-semibold">Ask your document anything</h3><p className="mt-1 text-sm text-slate-500">Answers use retrieved context from the selected PDF.</p></div>}
            {messages.map((msg, idx) => <div key={`${idx}-${msg.role}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[95%] rounded-2xl px-4 py-3 sm:max-w-[88%] ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-50 border border-slate-200'}`}>
                <div className="mb-1 text-xs font-semibold opacity-70">{msg.role === 'user' ? 'You' : 'RAG Assistant'}</div>
                {msg.role === 'assistant' ? <div className="prose prose-sm prose-slate max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || ''}</ReactMarkdown></div> : <p className="whitespace-pre-wrap text-sm">{msg.content}</p>}
                {msg.images?.length > 0 && <div className="mt-3"><p className="mb-2 text-xs font-semibold">Retrieved images</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{msg.images.map((image, i) => <img key={i} className="max-h-72 rounded-lg border border-slate-200 bg-white object-contain" src={`data:image/png;base64,${image}`} alt={`Retrieved document image ${i + 1}`} />)}</div></div>}
                {msg.role === 'assistant' && msg.sources?.length > 0 && <div className="mt-3 border-t border-slate-200 pt-2">
                  <button onClick={() => setSourcesFor(sourcesFor === idx ? null : idx)} className="text-xs font-semibold text-indigo-700 hover:underline">📎 {sourcesFor === idx ? 'Hide sources' : `Sources (${msg.sources.length})`}</button>
                  {sourcesFor === idx && <div className="mt-2 space-y-2">{msg.sources.map((s, i) => <div key={i} className="rounded-md border border-slate-200 bg-white p-2 text-xs"><strong>{i + 1}. {s.type || 'Document'}</strong><div className="text-slate-500">{s.page ? `Page ${s.page}` : 'Page information unavailable'}</div>{s.preview && s.type !== 'Image' && <p className="mt-1 text-slate-600">{s.preview}</p>}</div>)}</div>}
                </div>}
              </div>
            </div>)}
            {asking && <div className="flex justify-start"><div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500"><span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent align-middle" />Thinking…</div></div>}
            <div ref={chatEndRef} />
          </div>
          {error && <div className="mx-4 mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}<button className="ml-3 underline" onClick={() => setError('')}>Dismiss</button></div>}
          <form onSubmit={handleAsk} className="border-t border-slate-200 p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <textarea value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(e) } }} rows={2} placeholder={selectedPdf ? 'Ask a question about this PDF… (Enter to send, Shift+Enter for newline)' : 'Select or upload a PDF first'} disabled={!selectedPdf || asking} className="min-w-0 flex-1 resize-y rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100" />
              <button type="submit" disabled={!selectedPdf || !question.trim() || asking} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{asking ? 'Thinking…' : 'Send ↗'}</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">AI responses can be incorrect. Verify important information against the source PDF.</p>
          </form>
        </section>
      </main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">Virtual Techbox · Multimodal RAG · Pinecone + SQLite + FastAPI</footer>
    </div>
  )
}
export default App
