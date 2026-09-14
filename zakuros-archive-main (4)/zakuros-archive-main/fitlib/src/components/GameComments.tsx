import React, { useEffect, useState } from "react";
import {
  Send,
  Heart,
  Trash2,
  Flag,
  MessageSquare,
  Loader2,
  User,
} from "lucide-react";
import { useGame } from "../lib/gameContext";
import { GameComment } from "../types";

// Ported from UnionCrax GameComments: persistent community comments with
// likes, own-comment deletion, and abuse reporting. Guests participate via
// their stable visitor id.
export const GameComments: React.FC<{ gameId: string }> = ({ gameId }) => {
  const {
    getComments,
    addComment,
    deleteComment,
    toggleCommentLike,
    reportComment,
    authorKey,
    user,
  } = useGame();

  const [comments, setComments] = useState<GameComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = async () => {
    try {
      setComments(await getComments(gameId));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Failed to load comments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const post = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      await addComment(gameId, text.trim());
      setText("");
      await load();
    } catch (e: any) {
      setError(e.message ?? "Failed to post comment.");
    } finally {
      setPosting(false);
    }
  };

  const like = async (c: GameComment) => {
    if (actioning) return;
    setActioning(c.id);
    try {
      const wasLiked = c.likes.includes(authorKey);
      // Optimistic flip
      setComments((prev) =>
        prev.map((x) =>
          x.id === c.id
            ? { ...x, likes: wasLiked ? x.likes.filter((k) => k !== authorKey) : [...x.likes, authorKey] }
            : x
        )
      );
      const res = await toggleCommentLike(gameId, c.id, wasLiked);
      // Reconcile with server truth of whether it's now liked
      setComments((prev) =>
        prev.map((x) => {
          if (x.id !== c.id) return x;
          const has = x.likes.includes(authorKey);
          if (has === res.liked) return x;
          return { ...x, likes: res.liked ? [...x.likes, authorKey] : x.likes.filter((k) => k !== authorKey) };
        })
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActioning(null);
    }
  };

  const remove = async (c: GameComment) => {
    if (actioning) return;
    setActioning(c.id);
    try {
      await deleteComment(gameId, c.id);
      setComments((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e: any) {
      setError(e.message ?? "Failed to delete comment.");
    } finally {
      setActioning(null);
    }
  };

  const report = async (c: GameComment) => {
    if (actioning || c.reported) return;
    setActioning(c.id);
    try {
      await reportComment(gameId, c.id);
      setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, reported: true } : x)));
    } catch (e: any) {
      setError(e.message ?? "Failed to report comment.");
    } finally {
      setActioning(null);
    }
  };

  return (
    <div id="community_tab" className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-medium text-white text-md uppercase tracking-wider">
          Community Comments
        </h3>
        <span className="text-[10px] font-mono text-zinc-600">
          {comments.length} comment{comments.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Composer */}
      <div className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-950 border border-rose-500/20">
            <User className="h-3.5 w-3.5 text-rose-400" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-white font-display truncate">
              {user ? user.username : "Guest"}
            </p>
            <p className="text-[9px] font-mono text-zinc-600">
              {user ? "Signed in member" : "Posting anonymously"}
            </p>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
          }}
          maxLength={2000}
          placeholder="Share your experience with this repack — install size, run config, issues…"
          className="w-full resize-y rounded-lg border border-zinc-900 bg-black/40 p-3 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-rose-500/40 transition font-sans"
          rows={3}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] font-mono text-zinc-600">Ctrl+Enter to post</span>
          <button
            onClick={post}
            disabled={!text.trim() || posting}
            className="flex items-center gap-1.5 rounded-lg bg-rose-400 hover:bg-rose-300 disabled:opacity-40 disabled:cursor-not-allowed px-3.5 py-2 text-[11px] font-black text-black font-mono uppercase tracking-wider transition"
          >
            {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Post
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-[11px] font-mono text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-600">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-900 bg-zinc-950/20 py-10 text-center">
          <MessageSquare className="mx-auto mb-2 h-6 w-6 text-zinc-700" />
          <p className="text-xs font-bold text-zinc-500 font-display uppercase tracking-wider">No comments yet</p>
          <p className="mt-1 text-[11px] text-zinc-600">Be the first to review this repack.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const isMine = c.authorKey === authorKey;
            const liked = c.likes.includes(authorKey);
            return (
              <div
                key={c.id}
                id={`comment_${c.id}`}
                className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-4"
              >
                <div className="flex items-center justify-between border-b border-zinc-900 pb-2 mb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                      <User className="h-3 w-3 text-zinc-400" />
                    </span>
                    <span className="truncate text-[11px] font-bold text-white font-display">
                      {c.author}
                    </span>
                    {c.pinned && (
                      <span className="rounded bg-amber-950/50 border border-amber-500/25 px-1.5 py-0.5 text-[8px] font-bold text-amber-400 uppercase">Pinned</span>
                    )}
                    {c.reported && (
                      <span className="rounded bg-red-950/50 border border-red-500/25 px-1.5 py-0.5 text-[8px] font-bold text-red-400 uppercase">Flagged</span>
                    )}
                  </div>
                  <time className="shrink-0 text-[10px] font-mono text-zinc-600">
                    {new Date(c.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </time>
                </div>

                <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-400 font-sans">
                  {c.text}
                </p>

                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    onClick={() => like(c)}
                    disabled={actioning === c.id}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold font-mono transition cursor-pointer ${
                      liked
                        ? "bg-rose-950/30 text-rose-400 border border-rose-500/20"
                        : "bg-zinc-900 text-zinc-400 hover:text-rose-400 border border-zinc-800"
                    }`}
                  >
                    <Heart className={`h-3 w-3 ${liked ? "fill-current" : ""}`} />
                    {c.likes.length}
                  </button>

                  {isMine ? (
                    <button
                      onClick={() => remove(c)}
                      disabled={actioning === c.id}
                      className="flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 text-[10px] font-bold font-mono text-zinc-400 hover:text-red-400 border border-zinc-800 transition cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  ) : (
                    <button
                      onClick={() => report(c)}
                      disabled={actioning === c.id || c.reported}
                      className="flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 text-[10px] font-bold font-mono text-zinc-400 hover:text-amber-400 border border-zinc-800 transition cursor-pointer disabled:opacity-40"
                    >
                      <Flag className="h-3 w-3" />
                      {c.reported ? "Reported" : "Report"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};