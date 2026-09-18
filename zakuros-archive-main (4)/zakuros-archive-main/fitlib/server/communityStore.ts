import { loadStore, saveStore } from "./store";
import { GameComment, GameRating } from "../src/types";

// ── Community storage abstraction ────────────────────────────────────────────
// The community layer (comments + ratings) talks to this interface instead of
// touching files directly. The default implementation persists to
// data/comments.json and data/ratings.json (the project's single-file-JSON
// philosophy). To move the community data to another backend, implement
// CommunityStore and return it from createCommunityStore() — route handlers
// stay unchanged.

export interface CommunityStore {
  listComments(gameId: string): GameComment[];
  getComment(id: string): GameComment | undefined;
  addComment(comment: GameComment): void;
  removeComment(comment: GameComment): void;
  saveComments(): void;

  listRatings(gameId: string): GameRating[];
  findRating(gameId: string, authorKey: string): GameRating | undefined;
  addRating(rating: GameRating): void;
  saveRatings(): void;
}

class JsonFileCommunityStore implements CommunityStore {
  private comments = loadStore<GameComment[]>("comments", []);
  private ratings = loadStore<GameRating[]>("ratings", []);

  listComments(gameId: string): GameComment[] {
    return this.comments.filter((c) => c.gameId === gameId);
  }
  getComment(id: string): GameComment | undefined {
    return this.comments.find((c) => c.id === id);
  }
  addComment(comment: GameComment): void {
    this.comments.push(comment);
  }
  removeComment(comment: GameComment): void {
    const i = this.comments.indexOf(comment);
    if (i >= 0) this.comments.splice(i, 1);
  }
  saveComments(): void {
    saveStore("comments", this.comments);
  }

  listRatings(gameId: string): GameRating[] {
    return this.ratings.filter((r) => r.gameId === gameId);
  }
  findRating(gameId: string, authorKey: string): GameRating | undefined {
    return this.ratings.find((r) => r.gameId === gameId && r.authorKey === authorKey);
  }
  addRating(rating: GameRating): void {
    this.ratings.push(rating);
  }
  saveRatings(): void {
    saveStore("ratings", this.ratings);
  }
}

let instance: CommunityStore | null = null;

export function createCommunityStore(): CommunityStore {
  if (!instance) instance = new JsonFileCommunityStore();
  return instance;
}
