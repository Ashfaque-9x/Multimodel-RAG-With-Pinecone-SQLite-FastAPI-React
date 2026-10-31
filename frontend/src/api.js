import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "",
  timeout: 180000,
});

function messageFrom(error, fallback) {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

export async function getHealth() { return (await api.get("/api/health")).data; }
export async function getPdfs() { return (await api.get("/api/pdfs")).data.pdfs || []; }
export async function getMessages(pdfId) { return (await api.get(`/api/pdfs/${pdfId}/messages`)).data.messages || []; }

export async function uploadPdf(file) {
  try {
    const form = new FormData();
    form.append("file", file);
    return (await api.post("/api/documents/upload", form)).data;
  } catch (error) {
    throw new Error(messageFrom(error, "Failed to process PDF."));
  }
}
export async function askQuestion(pdf_id, question) {
  try {
    return (await api.post("/api/query", { pdf_id, question })).data;
  } catch (error) {
    throw new Error(messageFrom(error, "Failed to get an answer."));
  }
}
export async function clearChat(pdfId) {
  try { return (await api.delete(`/api/pdfs/${pdfId}/messages`)).data; }
  catch (error) { throw new Error(messageFrom(error, "Failed to clear chat.")); }
}
export async function deletePdf(pdfId) {
  try { return (await api.delete(`/api/pdfs/${pdfId}`)).data; }
  catch (error) { throw new Error(messageFrom(error, "Failed to delete PDF.")); }
}
