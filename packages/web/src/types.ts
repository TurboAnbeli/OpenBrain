export interface DocumentSummary {
  id: string;
  title: string;
  source_type: string;
  source_uri: string | null;
  content_preview: string;
  content_char_count: number;
  metadata: Record<string, unknown>;
  project: string | null;
  created_by: string | null;
  bank_id: string | null;
  document_kind: string | null;
  session_id: string | null;
  task_id: string | null;
  intent: string | null;
  event_started_at: string | null;
  event_ended_at: string | null;
  status: "active" | "archived" | "deleted";
  chunk_count: number;
  revision_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentDetail extends Omit<DocumentSummary, "content_preview" | "content_char_count" | "chunk_count" | "revision_count"> {
  content: string;
}

export interface UpdateDocumentInput {
  title?: string;
  source_uri?: string | null;
  content?: string;
  metadata?: Record<string, unknown>;
  status?: "active" | "archived" | "deleted";
  edit_reason?: string;
  updated_by?: string;
}

export interface DocumentRevision {
  id: string;
  document_id: string;
  revision_number: number;
  title: string;
  source_uri: string | null;
  content: string;
  metadata: Record<string, unknown>;
  status: string;
  edit_reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  token_count: number | null;
  char_start: number | null;
  char_end: number | null;
  created_at: string;
  updated_at: string;
}

export interface RevisionDiff {
  changed: boolean;
  old_content_chars: number;
  current_content_chars: number;
  char_delta: number;
  old_line_count: number;
  current_line_count: number;
  added_lines: number;
  removed_lines: number;
  unchanged_lines: number;
  title_changed: boolean;
  source_uri_changed: boolean;
  metadata_changed: boolean;
  status_changed: boolean;
}
