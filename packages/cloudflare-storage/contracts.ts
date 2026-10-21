export interface ProjectDocument {
  id: string;
  [key: string]: unknown;
}

export interface AssetRecord {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
}

/** Constructed with a workspace from a verified server-side session, never request JSON. */
export interface ProjectRepository {
  ids(): Promise<string[]>;
  summaries?(): Promise<{ id: string; title: string; createdAt: string; assets: number; batches: number }[]>;
  read(id: string): Promise<ProjectDocument>;
  // null = create only; every update requires the revision read by its caller.
  save(document: ProjectDocument, options: { expectedRevision: string | null }): Promise<void>;
}
