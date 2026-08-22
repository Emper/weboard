"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, Suspense } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ActivityFeed, { getCachedFeed, setCachedFeed } from "@/components/ActivityFeed";
import PageLoader from "@/components/PageLoader";
import Avatar from "@/components/Avatar";
import BggRating from "@/components/BggRating";
import GameReviewModal from "@/components/GameReviewModal";
import GroupGallery from "@/components/GroupGallery";
import GroupPlayedGames from "@/components/GroupPlayedGames";
import HelpMePickModal from "@/components/HelpMePickModal";
import { formatDuration, formatRelativeShort } from "@/lib/format";
import { getGroupType, type VoteOption } from "@/lib/groupTypes";

interface Game {
  id: string;
  bggId: number;
  name: string;
  thumbnail: string | null;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null;
  bggRating: number | null;
  bggRank: number | null;
  weight: number | null;
}

interface Voter {
  userId: string;
  name: string;
  value: number;
  comment: string | null;
}

interface RankedGame {
  groupGameId: string;
  game: Game;
  addedBy: { name: string | null; displayName: string | null };
  addedById: string;
  score: number;
  voters: Voter[];
  userVoteValue: number | null;
  playCount: number;
  playedAt: string | null;
  archivedAt: string | null;
  lastPlayedDate: string | null;
}

interface Member {
  role: string;
  user: {
    id: string;
    name: string | null;
    displayName: string | null;
    surname: string | null;
    email: string;
    bggUsername: string | null;
    avatarUrl: string | null;
  };
}

interface Invitation {
  email: string;
  createdAt: string;
}

interface GroupData {
  id: string;
  name: string;
  type: string;
  members: Member[];
  _count: { games: number };
  invitations: Invitation[];
  currentUserRole: string;
  currentUserId: string;
  currentUserLastPingedAt: string | null;
  inviteCode: string | null;
  inviteEnabled: boolean;
}

interface SuggestedGame {
  gameId: string;
  bggId: number;
  name: string;
  thumbnail: string | null;
  playingTime: number | null;
  weight: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  score: number;
}

interface SessionGame {
  id: string;
  order: number;
  status: string;
  game: {
    id: string;
    bggId: number;
    name: string;
    thumbnail: string | null;
    playingTime: number | null;
    minPlayers: number | null;
    maxPlayers: number | null;
    weight: number | null;
  };
}

interface GameSessionData {
  id: string;
  name: string | null;
  date: string;
  playerCount: number;
  totalMinutes: number;
  status: string;
  createdBy: { name: string | null };
  games: SessionGame[];
}

type Tab = "ranking" | "sessions" | "members" | "activity" | "gallery";

function VoteButton({
  option,
  active,
  onClick,
  size,
}: {
  option: VoteOption;
  active: boolean;
  onClick: () => void;
  size: "sm" | "md";
}) {
  const dims = size === "md" ? "w-9 h-9 text-lg" : "w-8 h-8 text-base";
  const activeClass =
    option.tone === "super"
      ? "bg-orange-500/20 border-orange-500 text-orange-400"
      : option.tone === "negative"
        ? "bg-red-500/20 border-red-500 text-red-400"
        : "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--primary)]";
  const labelColor =
    option.tone === "super"
      ? "text-orange-400/90"
      : option.tone === "negative"
        ? "text-red-400/90"
        : active
          ? "text-[var(--primary)]/90"
          : "text-[var(--text-muted)]";
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 group/vote"
      title={`${option.shortLabel} · ${option.label}`}
    >
      <span
        className={`${dims} flex items-center justify-center rounded-lg border transition-colors ${
          active ? activeClass : "border-[var(--border)] text-[var(--text-muted)] group-hover/vote:bg-[var(--surface-hover)]"
        }`}
      >
        {option.emoji}
      </span>
      <span className={`text-[9px] font-mono leading-none tabular-nums ${labelColor}`}>
        {option.shortLabel}
      </span>
    </button>
  );
}


export default function GroupDashboardWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg)]"><PageLoader /></div>}>
      <GroupDashboardPage />
    </Suspense>
  );
}

function GroupDashboardPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [group, setGroup] = useState<GroupData | null>(null);
  const [ranking, setRanking] = useState<RankedGame[]>([]);

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const tab = searchParams.get("tab");
    return tab === "ranking" || tab === "sessions" || tab === "members" || tab === "gallery"
      ? tab
      : "activity";
  });
  // Opinión post-partida: juego cuyo modal está abierto + modo (marcar / solo reseña)
  const [reviewModal, setReviewModal] = useState<{ gameId: string; gameName: string; mode: "mark" | "review" } | null>(null);
  const [galleryReloadKey, setGalleryReloadKey] = useState(0);
  // Subsección dentro de la pestaña "Juegos": ranking (pendientes) o jugados
  const [gamesSubTab, setGamesSubTab] = useState<"ranking" | "played">("ranking");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removingGame, setRemovingGame] = useState<string | null>(null);
  const [openVoteTooltip, setOpenVoteTooltip] = useState<string | null>(null);
  const [openKebabMenu, setOpenKebabMenu] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [openCommentEditors, setOpenCommentEditors] = useState<Set<string>>(new Set());
  const [commentToast, setCommentToast] = useState("");
  const [commentError, setCommentError] = useState("");

  // Group activity feed (restore from cache if available)
  const feedCacheKey = `group:${groupId}`;
  const cachedFeed = getCachedFeed(feedCacheKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [feedItems, setFeedItems] = useState<any[]>(cachedFeed?.items ?? []);
  const [feedCursor, setFeedCursor] = useState<string | null>(cachedFeed?.cursor ?? null);
  const [feedHasMore, setFeedHasMore] = useState(!!cachedFeed?.cursor);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedLoaded, setFeedLoaded] = useState(!!cachedFeed);

  // Sorteo "Ayúdame a elegir" sobre el ranking
  const [showRandomPicker, setShowRandomPicker] = useState(false);

  // Quick session from ranking
  const [quickSelectIds, setQuickSelectIds] = useState<Set<string>>(new Set());
  const [showQuickSession, setShowQuickSession] = useState(false);

  // Ping (convocatoria) modal
  const [showPingModal, setShowPingModal] = useState(false);
  const [pingMessage, setPingMessage] = useState("");
  const [pinging, setPinging] = useState(false);
  const [pingError, setPingError] = useState("");
  const [pingToast, setPingToast] = useState("");

  // Delete group modal (solo propietario)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Group stats (juegos, partidas, horas, juego más jugado, última partida)
  const [stats, setStats] = useState<{
    gamesCount: number;
    playsCount: number;
    totalMinutes: number;
    lastPlayedAt: string | null;
    topGame: { name: string; thumbnail: string | null; playCount: number } | null;
  } | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<GameSessionData[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    searchParams.get("session")
  );
  const [sessionDate, setSessionDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  });
  const [sessionPlayers, setSessionPlayers] = useState("4");
  const [sessionHours, setSessionHours] = useState("4");
  const [sessionName, setSessionName] = useState("");
  const [suggestedGames, setSuggestedGames] = useState<SuggestedGame[]>([]);
  const [allCandidates, setAllCandidates] = useState<SuggestedGame[]>([]);
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [savingSession, setSavingSession] = useState(false);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteError, setInviteError] = useState("");

  // Invite link state
  const [inviteLinkCode, setInviteLinkCode] = useState<string | null>(null);
  const [inviteLinkEnabled, setInviteLinkEnabled] = useState(true);
  const [inviteLinkLoading, setInviteLinkLoading] = useState(false);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);

  // Sync tab and session to URL
  const updateUrl = useCallback((tab: Tab, sessionId: string | null) => {
    const params = new URLSearchParams();
    if (tab !== "activity") params.set("tab", tab);
    if (sessionId) params.set("session", sessionId);
    const query = params.toString();
    router.replace(`/groups/${groupId}${query ? `?${query}` : ""}`, { scroll: false });
  }, [router, groupId]);

  const fetchGroupFeed = useCallback(async (cursor?: string) => {
    setFeedLoading(true);
    try {
      const url = `/api/groups/${groupId}/feed?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (cursor) {
          setFeedItems((prev) => {
            const seen = new Set(prev.map((i: { id: string }) => i.id));
            const merged = [...prev, ...data.items.filter((i: { id: string }) => !seen.has(i.id))];
            setCachedFeed(`group:${groupId}`, merged, data.nextCursor);
            return merged;
          });
        } else {
          setFeedItems(data.items);
          setCachedFeed(`group:${groupId}`, data.items, data.nextCursor);
        }
        setFeedCursor(data.nextCursor);
        setFeedHasMore(!!data.nextCursor);
        setFeedLoaded(true);
      }
    } finally {
      setFeedLoading(false);
    }
  }, [groupId]);

  const switchTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setExpandedSessionId(null);
    updateUrl(tab, null);
    if (tab === "activity") fetchGroupFeed();
  }, [updateUrl, fetchGroupFeed]);

  const toggleSession = useCallback((sessionId: string) => {
    const newId = expandedSessionId === sessionId ? null : sessionId;
    setExpandedSessionId(newId);
    updateUrl(activeTab, newId);
  }, [expandedSessionId, activeTab, updateUrl]);

  // Load feed if tab starts as "activity"
  useEffect(() => {
    if (activeTab === "activity" && !feedLoaded) fetchGroupFeed();
  }, [activeTab, feedLoaded, fetchGroupFeed]);

  // Close mobile vote tooltip when tapping outside
  useEffect(() => {
    if (!openVoteTooltip) return;
    const handleClick = () => setOpenVoteTooltip(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openVoteTooltip]);

  // Close kebab menu when tapping outside
  useEffect(() => {
    if (!openKebabMenu) return;
    const handleClick = () => setOpenKebabMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openKebabMenu]);

  const fetchData = useCallback(async () => {
    try {
      // Single API call loads everything: group, ranking, sessions
      const res = await fetch(`/api/groups/${groupId}/dashboard`, {
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error("Error al cargar el grupo");
      }

      const data = await res.json();

      setGroup(data.group);
      setRanking(data.ranking);
      setSessions(data.sessions);
      setStats(data.stats ?? null);
      if (data.group) {
        setInviteLinkCode(data.group.inviteCode);
        setInviteLinkEnabled(data.group.inviteEnabled ?? true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refresh sessions independently (after creating/editing a session)
  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/sessions`, {
        credentials: "include",
      });
      if (res.ok) {
        setSessions(await res.json());
      }
    } catch {
      // silent
    } finally {
      setLoadingSessions(false);
    }
  }, [groupId]);

  // Filter ranking for "tonight" mode
  // Split into pending (not yet played) and played
  const isPlayed = (item: RankedGame) => item.playCount > 0 || item.playedAt !== null;
  // Pendientes: no jugados y no archivados. Histórico: todos los jugados y
  // también los que se ocultaron en su día (archivados), jugados o no.
  const pendingGames = ranking.filter((item) => !item.archivedAt && !isPlayed(item));
  const playedGames = ranking.filter((item) => isPlayed(item) || item.archivedAt !== null);

  const isAdmin = group?.currentUserRole === "admin" || group?.currentUserRole === "owner";
  const groupTypeCfg = getGroupType(group?.type);
  const voteOptions = groupTypeCfg.allowedVotes;
  const isOwner = group?.currentUserRole === "owner";

  const PING_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  const pingAvailableAt = group?.currentUserLastPingedAt
    ? new Date(
        new Date(group.currentUserLastPingedAt).getTime() + PING_COOLDOWN_MS
      )
    : null;
  const canPing = !pingAvailableAt || pingAvailableAt.getTime() <= Date.now();

  const toggleQuickSelect = (gameId: string) => {
    setQuickSelectIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  };

  const handleQuickSession = async () => {
    setSavingSession(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sessionName || null,
          date: sessionDate,
          playerCount: parseInt(sessionPlayers),
          totalMinutes: parseFloat(sessionHours) * 60,
          gameIds: Array.from(quickSelectIds),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setQuickSelectIds(new Set());
        setShowQuickSession(false);
        setSessionName("");
        fetchData();
        switchTab("sessions");
        setTimeout(() => toggleSession(data.id), 300);
      }
    } finally {
      setSavingSession(false);
    }
  };

  const handleMarkPlayed = async (gameId: string, gameName: string, played: boolean) => {
    // Marcar como jugado abre el modal de opinión (nota + comentario + fotos).
    // Devolver a pendientes es una acción directa sin modal.
    if (played) {
      setReviewModal({ gameId, gameName, mode: "mark" });
      return;
    }
    if (!confirm(`¿Devolver "${gameName}" a pendientes?`)) return;
    try {
      const res = await fetch(`/api/groups/${groupId}/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ played: false }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Error al devolver a pendientes");
        return;
      }
      fetchData();
    } catch {
      alert("Error al devolver a pendientes");
    }
  };

  // Callback cuando se guarda/marca desde el modal de opinión.
  const handleReviewDone = useCallback(() => {
    fetchData();
    setGalleryReloadKey((k) => k + 1);
  }, [fetchData]);

  // Deep-link ?review=<gameId> (desde el email de encuesta): abre el modal de
  // opinión en modo "review" y limpia el parámetro para no reabrirlo.
  useEffect(() => {
    const reviewGameId = searchParams.get("review");
    if (!reviewGameId || ranking.length === 0) return;
    const match = ranking.find((r) => r.game.id === reviewGameId);
    if (match) {
      setReviewModal({ gameId: match.game.id, gameName: match.game.name, mode: "review" });
      setActiveTab("gallery");
      updateUrl("gallery", null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranking, searchParams]);

  // Helper: recompute ranking scores & sort after a local vote change
  const applyVoteLocally = useCallback(
    (
      prev: RankedGame[],
      targetGameDbId: string,
      newValue: number | null,
      oldValue: number | null,
      currentUserId: string
    ): RankedGame[] => {
      return prev
        .map((item) => {
          if (item.groupGameId !== targetGameDbId) return item;
          let { score } = item;
          const previousMe = item.voters.find((v) => v.userId === currentUserId);
          const myComment = previousMe?.comment ?? null;
          let voters = item.voters;
          if (oldValue !== null) {
            score -= oldValue;
            voters = voters.filter((v) => v.userId !== currentUserId);
          }
          if (newValue !== null) {
            score += newValue;
            const myName = previousMe?.name || "Tú";
            voters = [
              ...voters,
              { userId: currentUserId, name: myName, value: newValue, comment: myComment },
            ];
          } else if (myComment) {
            // El voto se va pero el comentario sigue: voter "virtual" con value=0.
            const myName = previousMe?.name || "Tú";
            voters = [
              ...voters,
              { userId: currentUserId, name: myName, value: 0, comment: myComment },
            ];
          }
          return { ...item, score, voters, userVoteValue: newValue };
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (b.game.bggRating || 0) - (a.game.bggRating || 0);
        });
    },
    []
  );

  const handleVote = async (
    gameId: string,
    gameDbId: string,
    value: number,
    currentValue: number | null
  ) => {
    if (!group) return;
    const isRemove = currentValue === value;
    const newValue = isRemove ? null : value;
    const snapshot = ranking;
    const groupTypeCfg = getGroupType(group.type);

    // ── Vote-limit conflict: ask before moving (e.g. super vote in friends) ──
    const limit = !isRemove ? groupTypeCfg.voteLimits.find((l) => l.value === value && l.max <= 1) : null;
    const conflicting = limit
      ? ranking.find((r) => r.userVoteValue === value && r.groupGameId !== gameDbId)
      : null;

    if (conflicting) {
      const optionLabel = groupTypeCfg.allowedVotes.find((v) => v.value === value)?.label || `voto de ${value}`;
      const move = confirm(
        `Ya tienes un ${optionLabel.toLowerCase()} en otro juego del grupo. ¿Lo mueves aquí? El anterior se quedará con un voto normal.`
      );
      if (!move) return;

      setRanking((prev) => {
        let next = applyVoteLocally(prev, conflicting.groupGameId, 1, value, group.currentUserId);
        next = applyVoteLocally(next, gameDbId, value, currentValue, group.currentUserId);
        return next;
      });
      setOpenCommentEditors((prev) => {
        if (prev.has(gameDbId)) return prev;
        const next = new Set(prev);
        next.add(gameDbId);
        return next;
      });

      try {
        const downgradeRes = await fetch(
          `/api/groups/${groupId}/games/${conflicting.game.id}/vote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ value: 1 }),
          }
        );
        if (!downgradeRes.ok) throw new Error();
        const res = await fetch(
          `/api/groups/${groupId}/games/${gameId}/vote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ value }),
          }
        );
        if (!res.ok) throw new Error();
      } catch {
        setRanking(snapshot);
        alert("Error al mover el voto");
      }
      return;
    }

    setRanking((prev) => applyVoteLocally(prev, gameDbId, newValue, currentValue, group.currentUserId));

    // Al votar (no al retirar), abrimos el editor de comentario para invitar a comentar.
    if (!isRemove) {
      setOpenCommentEditors((prev) => {
        if (prev.has(gameDbId)) return prev;
        const next = new Set(prev);
        next.add(gameDbId);
        return next;
      });
    }

    try {
      if (isRemove) {
        const res = await fetch(
          `/api/groups/${groupId}/games/${gameId}/vote`,
          { method: "DELETE", credentials: "include" }
        );
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch(
          `/api/groups/${groupId}/games/${gameId}/vote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ value }),
          }
        );
        if (!res.ok) throw new Error();
      }
    } catch {
      setRanking(snapshot);
      alert("Error al procesar el voto");
    }
  };

  const toggleCommentEditor = (gameDbId: string) => {
    setOpenCommentEditors((prev) => {
      const next = new Set(prev);
      if (next.has(gameDbId)) next.delete(gameDbId);
      else next.add(gameDbId);
      return next;
    });
  };

  const handleSaveComment = async (
    gameId: string,
    gameDbId: string,
    draft: string
  ) => {
    if (!group) return;
    const currentUserId = group.currentUserId;
    const item = ranking.find((r) => r.groupGameId === gameDbId);
    if (!item) return;

    const me = item.voters.find((v) => v.userId === currentUserId);
    const current = me?.comment ?? null;
    const next = draft.trim() === "" ? null : draft.trim();

    // Cerramos el editor en cualquier caso (al perder foco volvemos al display).
    setOpenCommentEditors((prev) => {
      if (!prev.has(gameDbId)) return prev;
      const next = new Set(prev);
      next.delete(gameDbId);
      return next;
    });

    if (next === current) {
      // Sin cambios reales; descartamos el draft para que vuelva al valor del servidor.
      setCommentDrafts((prev) => {
        const { [gameDbId]: _omit, ...rest } = prev;
        void _omit;
        return rest;
      });
      return;
    }

    const snapshot = ranking;

    // Optimista: actualizamos el voter del usuario actual con el nuevo comentario.
    setRanking((prev) =>
      prev.map((r) => {
        if (r.groupGameId !== gameDbId) return r;
        const existing = r.voters.find((v) => v.userId === currentUserId);
        let voters: Voter[];
        if (existing) {
          if (next === null && existing.value === 0) {
            // Voter "virtual" sin voto y sin comentario → se va.
            voters = r.voters.filter((v) => v.userId !== currentUserId);
          } else {
            voters = r.voters.map((v) =>
              v.userId === currentUserId ? { ...v, comment: next } : v
            );
          }
        } else {
          // No existía voter; si hay comentario, creamos uno virtual.
          voters = next
            ? [...r.voters, { userId: currentUserId, name: "Tú", value: r.userVoteValue ?? 0, comment: next }]
            : r.voters;
        }
        return { ...r, voters };
      })
    );

    try {
      const res = await fetch(
        `/api/groups/${groupId}/games/${gameId}/comment`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ text: draft.trim() }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al guardar el comentario");
      }
      setCommentDrafts((prev) => {
        const { [gameDbId]: _omit, ...rest } = prev;
        void _omit;
        return rest;
      });
      if (next) {
        setCommentToast("💬 Comentario guardado");
        setTimeout(() => setCommentToast(""), 3000);
      }
    } catch (err) {
      setRanking(snapshot);
      setCommentError(
        err instanceof Error ? err.message : "Error al guardar el comentario"
      );
      setTimeout(() => setCommentError(""), 4000);
    }
  };

  const handleRemoveGame = async (gameId: string, gameName: string) => {
    if (!confirm(`¿Eliminar "${gameName}" del grupo? Se perderán todos los votos.`)) return;
    setRemovingGame(gameId);
    try {
      const res = await fetch(`/api/groups/${groupId}/games/${gameId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al eliminar");
      }
      setRanking((prev) => prev.filter((r) => r.game.id !== gameId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al eliminar juego");
    } finally {
      setRemovingGame(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");
    setInviteMsg("");
    setInviting(true);

    try {
      const res = await fetch(`/api/groups/${groupId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: inviteEmail }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al enviar invitación");
      }

      setInviteMsg(`Invitación enviada a ${inviteEmail}`);
      setInviteEmail("");
      const groupRes = await fetch(`/api/groups/${groupId}`, {
        credentials: "include",
      });
      if (groupRes.ok) {
        setGroup(await groupRes.json());
      }
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setInviting(false);
    }
  };

  const handlePing = async () => {
    setPingError("");
    setPinging(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          pingMessage.trim() ? { message: pingMessage.trim() } : {}
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429 && data.nextAvailableAt) {
          const when = new Date(data.nextAvailableAt).toLocaleDateString(
            "es-ES",
            { day: "numeric", month: "long" }
          );
          throw new Error(`Ya convocaste esta semana. Disponible el ${when}.`);
        }
        throw new Error(data.error || "Error al convocar");
      }
      setGroup((g) =>
        g ? { ...g, currentUserLastPingedAt: new Date().toISOString() } : g
      );
      setShowPingModal(false);
      setPingMessage("");
      setPingToast(
        `📯 ¡Convocatoria enviada a ${data.recipientCount} jugador${
          data.recipientCount !== 1 ? "es" : ""
        }!`
      );
      setTimeout(() => setPingToast(""), 4000);
    } catch (err: unknown) {
      setPingError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setPinging(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!group || deleteConfirmText !== group.name) return;
    setDeleteError("");
    setDeleting(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al eliminar el grupo");
      }
      router.push("/groups");
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Error inesperado");
      setDeleting(false);
    }
  };

  // Session planning
  const handleSuggestGames = async () => {
    setLoadingSuggestion(true);
    try {
      const minutes = parseFloat(sessionHours) * 60;
      const res = await fetch(
        `/api/groups/${groupId}/sessions/suggest?players=${sessionPlayers}&minutes=${minutes}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Error al obtener sugerencias");
      const data = await res.json();
      setSuggestedGames(data.suggested);
      setAllCandidates(data.all);
      setSelectedGameIds(new Set(data.suggested.map((g: SuggestedGame) => g.gameId)));
    } catch {
      alert("Error al generar sugerencias");
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const toggleGameSelection = (gameId: string) => {
    setSelectedGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
      } else {
        next.add(gameId);
      }
      return next;
    });
  };

  const selectedTotalTime = allCandidates
    .filter((g) => selectedGameIds.has(g.gameId))
    .reduce((acc, g) => acc + (g.playingTime || 90), 0);

  const handleSaveSession = async () => {
    setSavingSession(true);
    try {
      const orderedIds = allCandidates
        .filter((g) => selectedGameIds.has(g.gameId))
        .sort((a, b) => b.score - a.score)
        .map((g) => g.gameId);

      const res = await fetch(`/api/groups/${groupId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: sessionName || null,
          date: sessionDate,
          playerCount: sessionPlayers,
          totalMinutes: parseFloat(sessionHours) * 60,
          gameIds: orderedIds,
        }),
      });

      if (!res.ok) throw new Error("Error al crear sesión");

      // Reset form and refresh
      setShowNewSession(false);
      setSessionName("");
      setSuggestedGames([]);
      setAllCandidates([]);
      setSelectedGameIds(new Set());
      await fetchSessions();
    } catch {
      alert("Error al guardar la sesión");
    } finally {
      setSavingSession(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm("¿Eliminar esta sesión?")) return;
    try {
      await fetch(`/api/groups/${groupId}/sessions/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
      });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      alert("Error al eliminar sesión");
    }
  };

  const handleUpdateSession = async (sessionId: string, data: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/groups/${groupId}/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
    } catch {
      alert("Error al actualizar sesión");
    }
  };

  const handleGameStatus = async (sessionId: string, gameSessionGameId: string, newStatus: string) => {
    // ── Optimistic update ──
    const snapshot = sessions;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, games: s.games.map((g) => (g.id === gameSessionGameId ? { ...g, status: newStatus } : g)) }
          : s
      )
    );

    try {
      const res = await fetch(`/api/groups/${groupId}/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gameStatuses: { [gameSessionGameId]: newStatus } }),
      });
      if (!res.ok) throw new Error();
      // Reconcile with server response
      const updated = await res.json();
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
    } catch {
      setSessions(snapshot); // rollback
      alert("Error al actualizar estado");
    }
  };

  const handleRemoveGameFromSession = async (sessionId: string, gameIdToRemove: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const remainingIds = session.games
      .filter((g) => g.game.id !== gameIdToRemove)
      .map((g) => g.game.id);
    await handleUpdateSession(sessionId, { gameIds: remainingIds });
  };

  const handleReorderGame = async (sessionId: string, currentIndex: number, direction: "up" | "down") => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const gameIds = session.games.map((g) => g.game.id);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= gameIds.length) return;
    [gameIds[currentIndex], gameIds[targetIndex]] = [gameIds[targetIndex], gameIds[currentIndex]];
    await handleUpdateSession(sessionId, { gameIds });
  };

  const handleAddGameToSession = async (sessionId: string) => {
    // Get suggestions for this session's parameters
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    try {
      const res = await fetch(
        `/api/groups/${groupId}/sessions/suggest?players=${session.playerCount}&minutes=${session.totalMinutes}`,
        { credentials: "include" }
      );
      if (!res.ok) return;
      const data = await res.json();
      // Filter out games already in session
      const existingIds = new Set(session.games.map((g) => g.game.id));
      const available = data.all.filter((g: SuggestedGame) => !existingIds.has(g.gameId));
      if (available.length === 0) {
        alert("No hay más juegos compatibles disponibles");
        return;
      }
      setAllCandidates(available);
      setSuggestedGames([]);
      setSelectedGameIds(new Set());
      setEditingSessionId(sessionId);
    } catch {
      alert("Error al cargar juegos disponibles");
    }
  };

  const handleConfirmAddGames = async () => {
    if (!editingSessionId) return;
    const session = sessions.find((s) => s.id === editingSessionId);
    if (!session) return;
    const existingIds = session.games.map((g) => g.game.id);
    const newIds = allCandidates
      .filter((g) => selectedGameIds.has(g.gameId))
      .map((g) => g.gameId);
    await handleUpdateSession(editingSessionId, {
      gameIds: [...existingIds, ...newIds],
    });
    setEditingSessionId(null);
    setAllCandidates([]);
    setSelectedGameIds(new Set());
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <PageLoader withNavbar />
      </>
    );
  }

  if (error || !group) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-red-400">{error || "Grupo no encontrado"}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-[var(--bg)] py-4 sm:py-6 px-3 sm:px-4">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-4 sm:mb-6 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-[var(--text)]">{group.name}</h1>
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--accent-soft)] text-[var(--primary)] border border-[var(--primary)]/20"
                  title={groupTypeCfg.description}
                >
                  <span>{groupTypeCfg.emoji}</span>
                  <span>{groupTypeCfg.label}</span>
                </span>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                {group.members.length} miembros &middot; {group._count.games}{" "}
                juegos
              </p>
            </div>
            <div className="relative group/ping shrink-0">
              <button
                onClick={() => canPing && setShowPingModal(true)}
                disabled={!canPing}
                className="px-3 sm:px-4 py-2 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] rounded-xl hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text)] text-xs sm:text-sm font-semibold transition-all duration-200 shadow-sm"
              >
                📯 <span className="hidden sm:inline">Convocar a los jugadores</span><span className="sm:hidden">Convocar</span>
              </button>
              <span
                role="tooltip"
                className="pointer-events-none opacity-0 group-hover/ping:opacity-100 group-focus-within/ping:opacity-100 absolute right-0 top-full mt-1.5 z-50 w-max max-w-[260px] bg-[var(--bg)] border border-[var(--border-strong)] rounded-lg shadow-xl px-3 py-2 text-xs text-[var(--text-secondary)] text-left transition-opacity duration-150"
              >
                {canPing
                  ? "Envía un email al grupo para pedirles que voten"
                  : `Disponible de nuevo el ${pingAvailableAt?.toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`}
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b border-[var(--border)] overflow-x-auto no-scrollbar">
            {(["activity", "ranking", "sessions", "gallery", "members"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => switchTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors shrink-0 whitespace-nowrap ${
                  activeTab === tab
                    ? "border-[var(--primary)] text-[var(--primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text)]"
                }`}
              >
                {tab === "ranking" ? "Juegos" : tab === "sessions" ? "Sesiones" : tab === "members" ? "Miembros" : tab === "gallery" ? "Galería" : "Actividad"}
              </button>
            ))}
          </div>

          {/* ═══════════ Ranking Tab ═══════════ */}
          {activeTab === "ranking" && (
            <div>
              {ranking.length === 0 ? (
                <div className="text-center">
                  <div className="flex items-center justify-end mb-4">
                    <Link
                      href={`/groups/${groupId}/add-games${(() => {
                        const firstBgg = group.members.find((m) => m.user.bggUsername)?.user.bggUsername;
                        return firstBgg ? `?user=${encodeURIComponent(firstBgg)}` : "";
                      })()}`}
                      prefetch={false}
                      className="px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] text-sm font-semibold shrink-0 transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      Añadir juegos
                    </Link>
                  </div>
                  <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-6 text-[var(--text-secondary)]">
                    No hay juegos en este grupo todavía. ¡Añade algunos!
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Conmutador de subsección: Ranking (pendientes) / Ya jugados */}
                  <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: "var(--surface)" }}>
                    {([
                      { key: "ranking" as const, label: `Ranking (${pendingGames.length})` },
                      { key: "played" as const, label: `Histórico (${playedGames.length})` },
                    ]).map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setGamesSubTab(s.key)}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                        style={
                          gamesSubTab === s.key
                            ? { background: "var(--primary)", color: "var(--primary-text)" }
                            : { color: "var(--text-secondary)" }
                        }
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {/* ── Ranking: juegos pendientes de jugar ── */}
                  {gamesSubTab === "ranking" && (pendingGames.length > 0 ? (
                    <div>
                      <div className="sticky top-[61px] z-10 bg-[var(--bg)] py-2 -mx-1 px-1">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                            Pendientes de jugar ({pendingGames.length})
                          </h3>
                          {quickSelectIds.size > 0 ? (
                            <div className="flex items-center gap-2 sm:gap-3">
                              <span className="text-xs sm:text-sm text-[var(--text-secondary)]">
                                {quickSelectIds.size} seleccionado{quickSelectIds.size !== 1 && "s"}
                              </span>
                              <button
                                onClick={() => setQuickSelectIds(new Set())}
                                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                              >
                                ✕
                              </button>
                              <button
                                onClick={() => setShowQuickSession(true)}
                                className="px-3 sm:px-4 py-2 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] text-xs sm:text-sm font-semibold transition-all duration-200 shadow-sm hover:shadow-md"
                              >
                                🎲 Crear sesión
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 shrink-0">
                              {pendingGames.length >= 2 && (
                                <button
                                  onClick={() => setShowRandomPicker(true)}
                                  title="Ayúdame a elegir: sorteo entre los mejores del ranking"
                                  aria-label="Ayúdame a elegir"
                                  className="px-3 py-2.5 rounded-xl border border-[var(--primary)]/40 text-[var(--primary)] hover:bg-[var(--accent-soft)] text-sm font-semibold shrink-0 transition-all duration-200"
                                >
                                  🎯<span className="ml-1.5 sm:hidden">Elegir</span>
                                  <span className="hidden sm:inline ml-1.5">Ayúdame a elegir</span>
                                </button>
                              )}
                              <Link
                                href={`/groups/${groupId}/add-games${(() => {
                                  const firstBgg = group.members.find((m) => m.user.bggUsername)?.user.bggUsername;
                                  return firstBgg ? `?user=${encodeURIComponent(firstBgg)}` : "";
                                })()}`}
                                prefetch={false}
                                className="px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] text-sm font-semibold shrink-0 transition-all duration-200 shadow-sm hover:shadow-md"
                              >
                                Añadir juegos
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Available-slot banner for limited votes (e.g. super vote in friends mode) */}
                      {(() => {
                        if (pendingGames.length === 0 || !group) return null;
                        const cfg = getGroupType(group.type);
                        const limit = cfg.voteLimits.find((l) => l.max <= 1);
                        if (!limit) {
                          // Mode without vote limits → show ranking hint instead, if any
                          if (!cfg.rankingHint) return null;
                          return (
                            <div className="flex items-start gap-2 px-3 py-2.5 mb-2 rounded-xl bg-[var(--accent-soft)] border border-[var(--primary)]/15">
                              <span className="text-base shrink-0 mt-0.5">💡</span>
                              <p className="text-xs sm:text-sm text-[var(--primary)] font-medium">{cfg.rankingHint}</p>
                            </div>
                          );
                        }
                        const limitOption = cfg.allowedVotes.find((v) => v.value === limit.value);
                        const usedUserIds = new Set<string>();
                        ranking.forEach((r) => {
                          r.voters.forEach((v) => {
                            if (v.value === limit.value) usedUserIds.add(v.userId);
                          });
                        });
                        const membersWithAvailable = group.members.filter(
                          (m) => !usedUserIds.has(m.user.id)
                        );
                        if (membersWithAvailable.length === 0) return null;
                        const currentUserAvailable = membersWithAvailable.some(
                          (m) => m.user.id === group.currentUserId
                        );
                        const others = membersWithAvailable.filter(
                          (m) => m.user.id !== group.currentUserId
                        );
                        const otherNames = others.map((m) => m.user.displayName || m.user.name || m.user.email);
                        const optionLabel = (limitOption?.label || "super voto").toLowerCase();
                        const otherText = others.length === 1
                          ? `${otherNames[0]} tiene su ${optionLabel} libre`
                          : `${otherNames.join(", ")} tienen su ${optionLabel} libre`;
                        const isMultiLine = currentUserAvailable && others.length > 0;
                        return (
                          <div className={`flex ${isMultiLine ? "items-start" : "items-center"} gap-2 px-3 py-2.5 mb-2 rounded-xl bg-[var(--accent-soft)] border border-[var(--primary)]/15`}>
                            <span className={`text-base shrink-0 ${isMultiLine ? "mt-0.5" : ""}`}>{limitOption?.emoji || "🔥"}</span>
                            <div className="text-xs sm:text-sm text-[var(--primary)]">
                              {currentUserAvailable && (
                                <p className="font-semibold">¡Tienes tu {optionLabel} disponible! Úsalo en el juego que más te apetezca ({limitOption?.shortLabel || "+3"} puntos).</p>
                              )}
                              {others.length > 0 && (
                                <p className={currentUserAvailable ? "mt-0.5 opacity-75 font-normal" : "font-medium"}>
                                  {otherText}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="space-y-3">
                        {pendingGames.map((item, index) => {
                          const isEditorOpen = openCommentEditors.has(item.groupGameId);
                          const hasOtherComments = item.voters.some(
                            (v) =>
                              v.comment &&
                              v.comment.trim() !== "" &&
                              v.userId !== group?.currentUserId
                          );
                          const myCommentExists = !!item.voters.find(
                            (v) => v.userId === group?.currentUserId
                          )?.comment;
                          // Cuando NO hay nada que mostrar (ni editor abierto ni comentarios)
                          // recuperamos la versión compacta: acciones absolutas en la esquina
                          // inferior derecha y un poco de padding extra para que no pisen.
                          const compact = !isEditorOpen && !hasOtherComments && !myCommentExists;
                          return (
                          <div
                            key={item.groupGameId}
                            className="relative bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-3 sm:p-4 transition-all duration-200"
                          >
                            {/* Main row: Position + Thumbnail + Name/Badges + Votes+Score */}
                            <div className="flex items-center gap-2 sm:gap-4">
                              {/* Position badge — click to select, hover shows checkbox */}
                              {(() => {
                                const isSelected = quickSelectIds.has(item.game.id);
                                const hasSelection = quickSelectIds.size > 0;
                                return (
                                  <div
                                    className="w-7 sm:w-10 shrink-0 flex justify-center group/check cursor-pointer"
                                    onClick={() => toggleQuickSelect(item.game.id)}
                                  >
                                    {/* Checkbox */}
                                    <div className={`items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-lg border-2 transition-all ${
                                      isSelected
                                        ? "flex bg-[var(--primary)] border-[var(--primary)]"
                                        : hasSelection
                                          ? "flex border-[var(--border-strong)] hover:border-[var(--primary)]/50"
                                          : "hidden group-hover/check:flex border-[var(--border-strong)] hover:border-[var(--primary)]/50"
                                    }`}>
                                      {isSelected && (
                                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[var(--primary-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </div>
                                    {/* Medal/Number — hidden when checkbox visible */}
                                    <div className={`${isSelected ? "hidden" : hasSelection ? "hidden" : "flex group-hover/check:hidden"} items-center justify-center`}>
                                      {index < 3 ? (
                                        <svg className="w-6 h-6 sm:w-9 sm:h-9" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                                          <defs>
                                            {index === 0 && (
                                              <linearGradient id="medal-gold" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                                                <stop offset="0%" stopColor="#fbbf24" />
                                                <stop offset="50%" stopColor="#f59e0b" />
                                                <stop offset="100%" stopColor="#d97706" />
                                              </linearGradient>
                                            )}
                                            {index === 1 && (
                                              <linearGradient id="medal-silver" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                                                <stop offset="0%" stopColor="#e2e8f0" />
                                                <stop offset="50%" stopColor="#94a3b8" />
                                                <stop offset="100%" stopColor="#64748b" />
                                              </linearGradient>
                                            )}
                                            {index === 2 && (
                                              <linearGradient id="medal-bronze" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                                                <stop offset="0%" stopColor="#d97756" />
                                                <stop offset="50%" stopColor="#b45930" />
                                                <stop offset="100%" stopColor="#92400e" />
                                              </linearGradient>
                                            )}
                                          </defs>
                                          <circle cx="18" cy="18" r="16" fill={`url(#medal-${index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze'})`} opacity="0.15" />
                                          <circle cx="18" cy="18" r="16" stroke={`url(#medal-${index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze'})`} strokeWidth="2" fill="none" />
                                          <text x="18" y="24" textAnchor="middle" fontSize="16" fontWeight="800" fill={index === 0 ? '#fbbf24' : index === 1 ? '#cbd5e1' : '#d97756'}>
                                            {index + 1}
                                          </text>
                                        </svg>
                                      ) : (
                                        <span className="text-sm sm:text-base font-bold text-[var(--text-muted)]">#{index + 1}</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Thumbnail: 64px en móvil, 130px top 3 / 100px resto en desktop */}
                              <div className={`w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-[var(--surface-hover)] ${index < 3 ? 'sm:w-[130px] sm:h-[130px]' : 'sm:w-[100px] sm:h-[100px]'}`}>
                                {item.game.thumbnail ? (
                                  <Image src={item.game.thumbnail} alt={item.game.name} width={130} height={130} className="w-full h-full object-contain" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-xs">?</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-[var(--text)] text-sm sm:text-base leading-tight">
                                  <a
                                    href={`https://boardgamegeek.com/boardgame/${item.game.bggId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-[var(--primary)] transition-colors"
                                  >
                                    {item.game.name}
                                  </a>
                                  {item.game.yearPublished && (
                                    <span className="text-[var(--text-muted)] font-normal ml-1 text-xs">({item.game.yearPublished})</span>
                                  )}
                                </div>
                                {/* Badges inline (debajo del título, en ambos breakpoints) */}
                                <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 mt-1.5 sm:mt-2">
                                  {item.game.bggRating && (
                                    <BggRating rating={item.game.bggRating} size={30} />
                                  )}
                                  {item.game.bggRank && (
                                    <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-amber-500/20 text-amber-300" title="Puesto en el ranking global de BGG">
                                      🏆 BGG #{item.game.bggRank.toLocaleString("es-ES")}
                                    </span>
                                  )}
                                  {item.game.playingTime && (
                                    <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-emerald-500/20 text-emerald-300">
                                      ⏱ {formatDuration(item.game.playingTime)}
                                    </span>
                                  )}
                                  {item.game.weight && (
                                    <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-purple-500/20 text-purple-300">
                                      ⚖️ {item.game.weight.toFixed(1)}
                                    </span>
                                  )}
                                  {(item.game.minPlayers || item.game.maxPlayers) && (
                                    <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-[var(--surface-hover)] text-[var(--text-secondary)]">
                                      {item.game.minPlayers === item.game.maxPlayers
                                        ? `${item.game.minPlayers}p`
                                        : `${item.game.minPlayers || "?"}-${item.game.maxPlayers || "?"}p`}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {/* Desktop: Vote buttons + Score, vertically centered */}
                              <div className="hidden sm:flex items-center gap-3 shrink-0">
                                <div className="flex gap-1.5 flex-wrap justify-end max-w-[260px]">
                                  {voteOptions.map((opt) => (
                                    <VoteButton
                                      key={opt.value}
                                      option={opt}
                                      active={item.userVoteValue === opt.value}
                                      onClick={() => handleVote(item.game.id, item.groupGameId, opt.value, item.userVoteValue)}
                                      size="md"
                                    />
                                  ))}
                                </div>
                                <div className="relative group/score text-center w-12 cursor-default">
                                  <div className="text-xl font-bold text-[var(--text)]">{item.score}</div>
                                  <div className="text-xs text-[var(--text-muted)]">pts</div>
                                  {/* Tooltip with voter breakdown */}
                                  {item.voters.some((v) => v.value !== 0) && (
                                    <div className="absolute bottom-full right-0 mb-2 hidden group-hover/score:block z-50">
                                      <div className="bg-[var(--bg)] border border-[var(--border-strong)] rounded-lg shadow-xl p-3 min-w-[180px] text-left">
                                        <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Votos</div>
                                        <div className="space-y-1.5">
                                          {item.voters.filter((v) => v.value !== 0).map((voter, vi) => (
                                            <div key={vi} className="flex items-center justify-between gap-3 text-xs">
                                              <span className="text-[var(--text-secondary)] truncate max-w-[120px]">{voter.name}</span>
                                              <span className={`font-bold whitespace-nowrap ${voter.value >= 3 ? 'text-orange-400' : voter.value < 0 ? 'text-red-400' : 'text-[var(--primary)]'}`}>
                                                {voter.value > 0 ? '+' : ''}{voter.value}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="border-t border-[var(--border)] mt-2 pt-1.5 flex justify-between text-xs font-bold">
                                          <span className="text-[var(--text-secondary)]">Total</span>
                                          <span className="text-[var(--text)]">{item.score}</span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              {/* Mobile: Score with tap-to-toggle tooltip */}
                              <div className="relative text-center shrink-0 sm:hidden">
                                <div
                                  className="cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenVoteTooltip(openVoteTooltip === item.groupGameId ? null : item.groupGameId);
                                  }}
                                >
                                  <div className="text-lg font-bold text-[var(--text)]">{item.score}</div>
                                  <div className="text-[10px] text-[var(--text-muted)]">pts</div>
                                </div>
                                {item.voters.some((v) => v.value !== 0) && openVoteTooltip === item.groupGameId && (
                                  <div className="absolute bottom-full right-0 mb-2 z-50">
                                    <div className="bg-[var(--bg)] border border-[var(--border-strong)] rounded-lg shadow-xl p-3 min-w-[160px] text-left">
                                      <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Votos</div>
                                      <div className="space-y-1.5">
                                        {item.voters.filter((v) => v.value !== 0).map((voter, vi) => (
                                          <div key={vi} className="flex items-center justify-between gap-3 text-xs">
                                            <span className="text-[var(--text-secondary)] truncate max-w-[100px]">{voter.name}</span>
                                            <span className={`font-bold whitespace-nowrap ${voter.value >= 3 ? 'text-orange-400' : voter.value < 0 ? 'text-red-400' : 'text-[var(--primary)]'}`}>
                                              {voter.value > 0 ? '+' : ''}{voter.value}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                      <div className="border-t border-[var(--border)] mt-2 pt-1.5 flex justify-between text-xs font-bold">
                                        <span className="text-[var(--text-secondary)]">Total</span>
                                        <span className="text-[var(--text)]">{item.score}</span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Row 2 mobile only: Kebab "Más" (izquierda) + Vote buttons (derecha) */}
                            <div className="flex sm:hidden items-center justify-between gap-2 mt-2.5 pl-9">
                              <div className="relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenKebabMenu(openKebabMenu === item.groupGameId ? null : item.groupGameId);
                                  }}
                                  aria-label="Más acciones"
                                  className="inline-flex items-center gap-0 h-8 pl-1 pr-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors"
                                >
                                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                    <circle cx="12" cy="5" r="1.6" />
                                    <circle cx="12" cy="12" r="1.6" />
                                    <circle cx="12" cy="19" r="1.6" />
                                  </svg>
                                  <span className="text-[11px] font-medium whitespace-nowrap">Más</span>
                                </button>
                                {openKebabMenu === item.groupGameId && (
                                  <div
                                    className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl shadow-xl py-1 min-w-[180px]"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      onClick={() => {
                                        setOpenKebabMenu(null);
                                        toggleCommentEditor(item.groupGameId);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                                    >
                                      💬{" "}
                                      {item.voters.find((v) => v.userId === group?.currentUserId)?.comment
                                        ? "Edita tu comentario"
                                        : "Deja un comentario"}
                                    </button>
                                    {isAdmin && (
                                      <>
                                        <button
                                          onClick={() => {
                                            setOpenKebabMenu(null);
                                            handleMarkPlayed(item.game.id, item.game.name, true);
                                          }}
                                          className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                                        >
                                          Marcar jugado
                                        </button>
                                        <button
                                          onClick={() => {
                                            setOpenKebabMenu(null);
                                            handleRemoveGame(item.game.id, item.game.name);
                                          }}
                                          disabled={removingGame === item.game.id}
                                          className="w-full text-left px-3 py-2 text-sm text-rose-500 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                                        >
                                          Quitar
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {voteOptions.map((opt) => (
                                  <VoteButton
                                    key={opt.value}
                                    option={opt}
                                    active={item.userVoteValue === opt.value}
                                    onClick={() => handleVote(item.game.id, item.groupGameId, opt.value, item.userVoteValue)}
                                    size="sm"
                                  />
                                ))}
                              </div>
                            </div>
                            {/* Comentarios: input (cuando el editor está abierto) + lista del resto */}
                            {(() => {
                              const isEditorOpen = openCommentEditors.has(item.groupGameId);
                              const me = item.voters.find((v) => v.userId === group?.currentUserId);
                              const myComment = me?.comment ?? null;
                              const visibleComments = item.voters.filter(
                                (v) =>
                                  v.comment &&
                                  v.comment.trim() !== "" &&
                                  (!isEditorOpen || v.userId !== group?.currentUserId)
                              );
                              if (!isEditorOpen && visibleComments.length === 0) return null;
                              const draftValue = commentDrafts[item.groupGameId] ?? myComment ?? "";
                              return (
                                <div className="mt-3 pl-9 sm:pl-14 space-y-2">
                                  {isEditorOpen && (
                                    <textarea
                                      autoFocus
                                      rows={1}
                                      maxLength={500}
                                      value={draftValue}
                                      onChange={(e) =>
                                        setCommentDrafts((prev) => ({
                                          ...prev,
                                          [item.groupGameId]: e.target.value,
                                        }))
                                      }
                                      onBlur={(e) =>
                                        handleSaveComment(item.game.id, item.groupGameId, e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                          e.preventDefault();
                                          e.currentTarget.blur();
                                        }
                                      }}
                                      placeholder="Deja un comentario (opcional)"
                                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all resize-none"
                                    />
                                  )}
                                  {visibleComments.length > 0 && (
                                    <div className="space-y-1.5 pt-1">
                                      {visibleComments.map((v) => (
                                        <div key={v.userId} className="flex items-start gap-1.5 text-xs leading-relaxed">
                                          <span aria-hidden className="shrink-0 leading-none mt-px">💬</span>
                                          <div className="min-w-0">
                                            <span className="font-semibold text-[var(--text-secondary)]">
                                              {v.name}:
                                            </span>{" "}
                                            <span className="text-[var(--text)] italic">
                                              “{v.comment}”
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {/* Acciones inferiores — desktop: Comenta + (admin) Marcar/Quitar.
                                Si la tarjeta es compacta (sin comentarios ni editor) flotan en la
                                esquina inferior derecha; si hay comentarios, en flujo bajo el bloque. */}
                            <div className={`hidden sm:flex justify-end gap-3 text-[11px] ${compact ? "absolute bottom-2 right-3" : "mt-3"}`}>
                              <button
                                onClick={() => toggleCommentEditor(item.groupGameId)}
                                className="text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors"
                              >
                                {myCommentExists ? "Edita tu comentario" : "Deja un comentario"}
                              </button>
                              {isAdmin && (
                                <>
                                  <button
                                    onClick={() => handleMarkPlayed(item.game.id, item.game.name, true)}
                                    className="text-[var(--text-muted)] hover:text-emerald-400 transition-colors"
                                  >
                                    Marcar jugado
                                  </button>
                                  <button
                                    onClick={() => handleRemoveGame(item.game.id, item.game.name)}
                                    disabled={removingGame === item.game.id}
                                    className="text-[var(--text-muted)] hover:text-red-400 transition-colors disabled:opacity-50"
                                  >
                                    Quitar
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-center py-12 text-sm" style={{ color: "var(--text-muted)" }}>
                      No hay juegos pendientes de jugar.
                    </p>
                  ))}

                  {/* ── Histórico de partidas ── */}
                  {gamesSubTab === "played" && (
                    <GroupPlayedGames
                      games={playedGames}
                      isAdmin={isAdmin}
                      onOpinion={(gameId, gameName) => setReviewModal({ gameId, gameName, mode: "review" })}
                      onReturn={(gameId, gameName) => handleMarkPlayed(gameId, gameName, false)}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Sorteo aleatorio entre el top del ranking */}
          {showRandomPicker && (
            <HelpMePickModal games={pendingGames} onClose={() => setShowRandomPicker(false)} />
          )}

          {/* Quick session modal */}
          {showQuickSession && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowQuickSession(false)}>
              <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-[var(--text)]">
                    🎲 Crear sesión rápida
                  </h3>
                  <button onClick={() => setShowQuickSession(false)} className="text-[var(--text-secondary)] hover:text-[var(--text)]">✕</button>
                </div>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  {quickSelectIds.size} juego{quickSelectIds.size !== 1 && "s"} seleccionado{quickSelectIds.size !== 1 && "s"}
                </p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Nombre (opcional)</label>
                    <input
                      type="text"
                      value={sessionName}
                      onChange={(e) => setSessionName(e.target.value)}
                      placeholder="Ej: Viernes épico"
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Fecha</label>
                    <input
                      type="date"
                      value={sessionDate}
                      onChange={(e) => setSessionDate(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Jugadores</label>
                    <select
                      value={sessionPlayers}
                      onChange={(e) => setSessionPlayers(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200"
                    >
                      {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <option key={n} value={n}>{n} jugadores</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Tiempo</label>
                    <select
                      value={sessionHours}
                      onChange={(e) => setSessionHours(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200"
                    >
                      <option value="1.5">1h 30min</option>
                      <option value="2">2 horas</option>
                      <option value="3">3 horas</option>
                      <option value="4">4 horas</option>
                      <option value="5">5 horas</option>
                      <option value="6">6 horas</option>
                      <option value="8">8 horas</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={handleQuickSession}
                  disabled={savingSession}
                  className="w-full px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] disabled:opacity-50 font-semibold text-sm transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  {savingSession ? "Creando..." : `Crear sesión con ${quickSelectIds.size} juego${quickSelectIds.size !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          )}

          {/* Delete group modal — solo propietario, requiere escribir el nombre */}
          {showDeleteModal && (
            <div
              className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
              onClick={() => !deleting && setShowDeleteModal(false)}
            >
              <div
                className="bg-[var(--surface)] rounded-2xl border border-red-500/40 shadow-[var(--card-shadow)] p-5 w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-red-400">
                    ⚠️ Eliminar grupo
                  </h3>
                  <button
                    onClick={() => !deleting && setShowDeleteModal(false)}
                    className="text-[var(--text-secondary)] hover:text-[var(--text)]"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-3 mb-4 text-sm text-[var(--text-secondary)]">
                  <p>
                    Vas a eliminar <strong className="text-[var(--text)]">&quot;{group.name}&quot;</strong> de forma permanente. Se borrarán:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5 pl-1 text-[var(--text-muted)]">
                    <li>Todos sus juegos y votos</li>
                    <li>Todas las sesiones planificadas y jugadas</li>
                    <li>Todos los miembros e invitaciones pendientes</li>
                    <li>Todo el historial de actividad del grupo</li>
                  </ul>
                  <p className="text-red-400 font-medium">
                    Esta acción no se puede deshacer.
                  </p>
                </div>
                <div className="mb-4">
                  <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
                    Para confirmar, escribe el nombre exacto del grupo: <span className="font-mono text-[var(--text)]">{group.name}</span>
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={group.name}
                    autoFocus
                    disabled={deleting}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-[var(--text)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-red-500/40 focus:border-red-500 focus:outline-none transition-all duration-200"
                  />
                </div>
                {deleteError && (
                  <p className="text-sm text-red-400 mb-3">{deleteError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeleteModal(false)}
                    disabled={deleting}
                    className="flex-1 px-4 py-2.5 bg-[var(--surface-hover)] text-[var(--text)] rounded-xl hover:bg-[var(--border)] disabled:opacity-50 font-semibold text-sm transition-all duration-200"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleDeleteGroup}
                    disabled={deleting || deleteConfirmText !== group.name}
                    className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-sm transition-all duration-200 shadow-sm"
                  >
                    {deleting ? "Eliminando..." : "Eliminar para siempre"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Ping modal */}
          {showPingModal && (
            <div
              className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
              onClick={() => !pinging && setShowPingModal(false)}
            >
              <div
                className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-5 w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-[var(--text)]">
                    📯 ¿Convocar a los jugadores?
                  </h3>
                  <button
                    onClick={() => !pinging && setShowPingModal(false)}
                    className="text-[var(--text-secondary)] hover:text-[var(--text)]"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Esto enviará un email a los demás miembros del grupo para pedirles que actualicen sus votos en el ranking. Solo puedes hacerlo una vez por semana.
                </p>
                <div className="mb-4">
                  <label className="block text-xs text-[var(--text-secondary)] mb-1">
                    Mensaje personal (opcional)
                  </label>
                  <textarea
                    value={pingMessage}
                    onChange={(e) => setPingMessage(e.target.value.slice(0, 200))}
                    placeholder="Ej: vamos el viernes a casa de Ana"
                    rows={3}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200 resize-none"
                  />
                  <div className="text-right text-xs text-[var(--text-muted)] mt-1">
                    {pingMessage.length}/200
                  </div>
                </div>
                {pingError && (
                  <p className="text-sm text-red-400 mb-3">{pingError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowPingModal(false)}
                    disabled={pinging}
                    className="flex-1 px-4 py-2.5 bg-transparent border border-[var(--border)] text-[var(--text)] rounded-xl hover:bg-[var(--border)]/30 disabled:opacity-50 font-semibold text-sm transition-all duration-200"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handlePing}
                    disabled={pinging}
                    className="flex-1 px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] disabled:opacity-50 font-semibold text-sm transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    {pinging ? "Enviando..." : "Convocar 📯"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Ping success toast */}
          {pingToast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--primary)] text-[var(--primary-text)] px-4 py-3 rounded-xl shadow-lg font-semibold text-sm">
              {pingToast}
            </div>
          )}

          {/* Comment toasts */}
          {commentToast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--primary)] text-[var(--primary-text)] px-4 py-3 rounded-xl shadow-lg font-semibold text-sm">
              {commentToast}
            </div>
          )}
          {commentError && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-3 rounded-xl shadow-lg font-semibold text-sm">
              {commentError}
            </div>
          )}

          {/* ═══════════ Sessions Tab ═══════════ */}
          {activeTab === "sessions" && (
            <div className="space-y-4">
              {/* New session button */}
              {!showNewSession && (
                <button
                  onClick={() => setShowNewSession(true)}
                  className="w-full px-4 py-3 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] font-semibold transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  🎲 Planificar sesión
                </button>
              )}

              {/* New session planner */}
              {showNewSession && (
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--primary)]/30 shadow-[var(--card-shadow)] p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-[var(--text)]">Nueva sesión</h3>
                    <button
                      onClick={() => { setShowNewSession(false); setSuggestedGames([]); setAllCandidates([]); }}
                      className="text-[var(--text-secondary)] hover:text-[var(--text)] text-sm"
                    >
                      ✕ Cancelar
                    </button>
                  </div>

                  {/* Session params */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--text-secondary)] mb-1">Nombre (opcional)</label>
                      <input
                        type="text"
                        value={sessionName}
                        onChange={(e) => setSessionName(e.target.value)}
                        placeholder="Ej: Viernes épico"
                        className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-secondary)] mb-1">Fecha</label>
                      <input
                        type="date"
                        value={sessionDate}
                        onChange={(e) => setSessionDate(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-secondary)] mb-1">Jugadores</label>
                      <select
                        value={sessionPlayers}
                        onChange={(e) => setSessionPlayers(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200"
                      >
                        {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n}>{n} jugadores</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-secondary)] mb-1">Tiempo disponible</label>
                      <select
                        value={sessionHours}
                        onChange={(e) => setSessionHours(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200"
                      >
                        <option value="1.5">1h 30min</option>
                        <option value="2">2 horas</option>
                        <option value="3">3 horas</option>
                        <option value="4">4 horas</option>
                        <option value="5">5 horas</option>
                        <option value="6">6 horas</option>
                        <option value="8">8 horas</option>
                        <option value="10">10 horas</option>
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={handleSuggestGames}
                    disabled={loadingSuggestion}
                    className="px-4 py-2 bg-[var(--accent-soft)] text-[var(--primary)] border border-[var(--primary)]/50 rounded-xl text-sm font-semibold hover:bg-[var(--primary)]/20 disabled:opacity-50 transition-all duration-200"
                  >
                    {loadingSuggestion ? "Calculando..." : "🎯 Sugerir juegos"}
                  </button>

                  {/* Suggested games */}
                  {allCandidates.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-[var(--text-secondary)]">
                          Selecciona los juegos para la sesión
                        </p>
                        <div className="text-sm">
                          <span className={`font-medium ${
                            selectedTotalTime > parseFloat(sessionHours) * 60
                              ? "text-red-400"
                              : "text-emerald-400"
                          }`}>
                            ⏱ {formatDuration(selectedTotalTime)}
                          </span>
                          <span className="text-[var(--text-muted)]"> / {formatDuration(parseFloat(sessionHours) * 60)}</span>
                        </div>
                      </div>

                      {/* Time bar */}
                      <div className="h-2 bg-[var(--surface-hover)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            selectedTotalTime > parseFloat(sessionHours) * 60
                              ? "bg-red-500"
                              : "bg-emerald-500"
                          }`}
                          style={{
                            width: `${Math.min(100, (selectedTotalTime / (parseFloat(sessionHours) * 60)) * 100)}%`,
                          }}
                        />
                      </div>

                      <div className="space-y-1">
                        {allCandidates.map((game) => {
                          const isSelected = selectedGameIds.has(game.gameId);
                          const wasSuggested = suggestedGames.some((g) => g.gameId === game.gameId);
                          return (
                            <button
                              key={game.gameId}
                              onClick={() => toggleGameSelection(game.gameId)}
                              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left ${
                                isSelected
                                  ? "bg-[var(--accent-soft)] border-[var(--primary)]/40"
                                  : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border-strong)]"
                              }`}
                            >
                              <div className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                isSelected
                                  ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-text)]"
                                  : "border-[var(--border-strong)]"
                              }`}>
                                {isSelected && <span className="text-xs font-bold">✓</span>}
                              </div>
                              <div className="w-10 h-10 shrink-0 rounded overflow-hidden bg-[var(--surface-hover)]">
                                {game.thumbnail ? (
                                  <Image src={game.thumbnail} alt={game.name} width={40} height={40} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-xs">?</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-[var(--text)] truncate">
                                  {game.name}
                                  {wasSuggested && (
                                    <span className="ml-1.5 text-xs bg-[var(--accent-soft)] text-[var(--primary)] px-1.5 py-0.5 rounded-full">
                                      sugerido
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-2 text-xs text-[var(--text-secondary)] mt-0.5">
                                  <span>⏱ {game.playingTime ? formatDuration(game.playingTime) : "~90min"}</span>
                                  <span>👥 {game.minPlayers}-{game.maxPlayers}</span>
                                  {game.weight && <span>⚖️ {game.weight.toFixed(1)}</span>}
                                  <span className="text-[var(--primary)]">{game.score} pts</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <button
                        onClick={handleSaveSession}
                        disabled={savingSession || selectedGameIds.size === 0}
                        className="w-full px-4 py-3 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] font-semibold disabled:opacity-50 transition-all duration-200 shadow-sm hover:shadow-md"
                      >
                        {savingSession
                          ? "Guardando..."
                          : `Crear sesión con ${selectedGameIds.size} juego${selectedGameIds.size !== 1 ? "s" : ""}`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Add games to existing session modal */}
              {editingSessionId && (
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--primary)]/30 shadow-[var(--card-shadow)] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--text)]">Añadir juegos a la sesión</h3>
                    <button
                      onClick={() => { setEditingSessionId(null); setAllCandidates([]); }}
                      className="text-[var(--text-secondary)] hover:text-[var(--text)] text-sm"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {allCandidates.map((game) => {
                      const isSelected = selectedGameIds.has(game.gameId);
                      return (
                        <button
                          key={game.gameId}
                          onClick={() => toggleGameSelection(game.gameId)}
                          className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-all duration-200 text-left ${
                            isSelected
                              ? "bg-[var(--accent-soft)] border-[var(--primary)]/40"
                              : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border-strong)]"
                          }`}
                        >
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                            isSelected ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-text)]" : "border-[var(--border-strong)]"
                          }`}>
                            {isSelected && <span className="text-xs font-bold">✓</span>}
                          </div>
                          <span className="text-sm text-[var(--text)] flex-1 truncate">{game.name}</span>
                          <span className="text-xs text-[var(--text-secondary)]">
                            ⏱ {game.playingTime ? formatDuration(game.playingTime) : "~90min"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedGameIds.size > 0 && (
                    <button
                      onClick={handleConfirmAddGames}
                      className="w-full px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] font-semibold text-sm transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      Añadir {selectedGameIds.size} juego{selectedGameIds.size !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              )}

              {/* Existing sessions */}
              {loadingSessions ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--primary)]" />
                </div>
              ) : sessions.length === 0 && !showNewSession ? (
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-6 text-center text-[var(--text-secondary)]">
                  No hay sesiones planificadas. ¡Crea la primera!
                </div>
              ) : (
                <div className="space-y-3">
                  {sessions.map((s) => {
                    const sDate = new Date(s.date);
                    const isPast = sDate < new Date();
                    const isExpanded = expandedSessionId === s.id;
                    const totalTime = s.games.reduce(
                      (acc, g) => acc + (g.game.playingTime || 90), 0
                    );
                    const completedGames = s.games.filter((g) => g.status === "completed").length;
                    const statusColors: Record<string, string> = {
                      planned: "bg-blue-500/20 text-blue-300",
                      playing: "bg-emerald-500/20 text-emerald-300",
                      completed: "bg-[var(--surface-hover)] text-[var(--text-secondary)]",
                    };
                    const statusLabels: Record<string, string> = {
                      planned: "Planificada",
                      playing: "En curso",
                      completed: "Completada",
                    };

                    return (
                      <div
                        key={s.id}
                        className={`bg-[var(--surface)] rounded-2xl border shadow-[var(--card-shadow)] transition-all duration-200 ${
                          s.status === "playing"
                            ? "border-emerald-500/40"
                            : isPast && s.status !== "completed"
                              ? "border-[var(--primary)]/30"
                              : "border-[var(--border)]"
                        }`}
                      >
                        {/* Session header — clickable to expand */}
                        <button
                          onClick={() => toggleSession(s.id)}
                          className="w-full p-3 sm:p-4 flex items-center gap-2 sm:gap-3 text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold text-[var(--text)] text-sm sm:text-base truncate">
                                {s.name || sDate.toLocaleDateString("es-ES", {
                                  weekday: "long",
                                  day: "numeric",
                                  month: "long",
                                })}
                              </h4>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium shrink-0 ${statusColors[s.status] || statusColors.planned}`}>
                                {statusLabels[s.status] || s.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] sm:text-xs text-[var(--text-secondary)] mt-1">
                              <span>📅 {sDate.toLocaleDateString("es-ES")}</span>
                              <span>👥 {s.playerCount}</span>
                              <span>⏱ {formatDuration(s.totalMinutes)}</span>
                              <span>🎲 {s.games.length} juego{s.games.length !== 1 ? "s" : ""}</span>
                              {completedGames > 0 && (
                                <span className="text-emerald-400">✓ {completedGames}/{s.games.length}</span>
                              )}
                            </div>
                          </div>
                          <svg
                            className={`w-5 h-5 text-[var(--text-muted)] transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="px-4 pb-4 space-y-3">
                            {/* Status controls */}
                            <div className="flex flex-wrap gap-2">
                              {(["planned", "playing", "completed"] as const).map((st) => (
                                <button
                                  key={st}
                                  onClick={() => handleUpdateSession(s.id, { status: st })}
                                  className={`px-3 py-1 rounded-xl text-xs font-medium border transition-all duration-200 ${
                                    s.status === st
                                      ? statusColors[st] + " border-current"
                                      : "bg-[var(--surface-hover)] text-[var(--text-secondary)] border-[var(--border-strong)] hover:border-[var(--border-strong)]"
                                  }`}
                                >
                                  {statusLabels[st]}
                                </button>
                              ))}
                            </div>

                            {/* Games list with actions */}
                            {s.games.length > 0 ? (
                              <div className="space-y-1.5">
                                {s.games.map((sg, idx) => {
                                  const gameStatusIcon: Record<string, string> = {
                                    pending: "⬜",
                                    playing: "🎮",
                                    completed: "✅",
                                    skipped: "⏭",
                                  };
                                  return (
                                    <div
                                      key={sg.id}
                                      className={`py-2 px-2 sm:px-3 rounded-xl transition-all duration-200 ${
                                        sg.status === "completed"
                                          ? "bg-emerald-500/10"
                                          : sg.status === "playing"
                                            ? "bg-[var(--accent-soft)]"
                                            : sg.status === "skipped"
                                              ? "bg-[var(--surface-hover)] opacity-60"
                                              : "bg-[var(--surface-hover)]"
                                      }`}
                                    >
                                      {/* Row 1: Reorder + Index + Thumbnail + Name + Time */}
                                      <div className="flex items-center gap-2">
                                        <div className="flex flex-col gap-0.5 shrink-0">
                                          <button
                                            disabled={idx === 0}
                                            onClick={() => handleReorderGame(s.id, idx, "up")}
                                            className="text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-20 text-base leading-none transition-colors p-0.5"
                                            title="Mover arriba"
                                          >▲</button>
                                          <button
                                            disabled={idx === s.games.length - 1}
                                            onClick={() => handleReorderGame(s.id, idx, "down")}
                                            className="text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-20 text-base leading-none transition-colors p-0.5"
                                            title="Mover abajo"
                                          >▼</button>
                                        </div>
                                        <span className="text-xs text-[var(--text-muted)] w-4 text-center shrink-0">{idx + 1}.</span>
                                        <div className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded overflow-hidden bg-[var(--surface-hover)]">
                                          {sg.game.thumbnail ? (
                                            <Image src={sg.game.thumbnail} alt={sg.game.name} width={32} height={32} className="w-full h-full object-cover" />
                                          ) : (
                                            <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-[10px]">?</div>
                                          )}
                                        </div>
                                        <a
                                          href={`https://boardgamegeek.com/boardgame/${sg.game.bggId}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs sm:text-sm text-[var(--text)] flex-1 min-w-0 truncate hover:text-[var(--primary)] transition-colors"
                                        >
                                          {sg.game.name}
                                        </a>
                                        <span className="text-[10px] sm:text-xs text-[var(--text-secondary)] shrink-0">
                                          ⏱ {sg.game.playingTime ? formatDuration(sg.game.playingTime) : "~90min"}
                                        </span>
                                      </div>
                                      {/* Row 2: Status buttons + Remove */}
                                      <div className="flex items-center justify-end gap-1 mt-1 pl-6 sm:pl-8">
                                        {(["pending", "playing", "completed", "skipped"] as const).map((gs) => (
                                          <button
                                            key={gs}
                                            onClick={() => handleGameStatus(s.id, sg.id, gs)}
                                            className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded text-xs sm:text-sm transition-colors ${
                                              sg.status === gs
                                                ? "bg-[var(--surface-hover)] ring-1 ring-[var(--primary)]/50"
                                                : "hover:bg-[var(--surface-hover)]"
                                            }`}
                                            title={gs === "pending" ? "Pendiente" : gs === "playing" ? "Jugando" : gs === "completed" ? "Jugado" : "Saltado"}
                                          >
                                            {gameStatusIcon[gs]}
                                          </button>
                                        ))}
                                        <button
                                          onClick={() => handleRemoveGameFromSession(s.id, sg.game.id)}
                                          className="text-[var(--text-muted)] hover:text-red-400 text-xs transition-colors shrink-0 ml-1"
                                          title="Quitar de la sesión"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                                <div className="flex items-center justify-between pt-1">
                                  <span className="text-xs text-[var(--text-muted)]">
                                    Total estimado: {formatDuration(totalTime)}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--text-muted)]">Sin juegos asignados</p>
                            )}

                            {/* Action buttons */}
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => handleAddGameToSession(s.id)}
                                className="px-3 py-1.5 bg-[var(--accent-soft)] text-[var(--primary)] border border-[var(--primary)]/50 rounded-xl text-xs font-medium hover:bg-[var(--primary)]/20 transition-all duration-200"
                              >
                                + Añadir juego
                              </button>
                              <button
                                onClick={() => handleDeleteSession(s.id)}
                                className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded-xl text-xs font-medium hover:bg-red-500/20 transition-all duration-200"
                              >
                                Eliminar sesión
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ═══════════ Members Tab ═══════════ */}
          {activeTab === "members" && (
            <div className="space-y-6">
              <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-6">
                <h2 className="text-lg font-semibold text-[var(--text)] mb-4">Miembros</h2>
                <div className="space-y-3">
                  {group.members.map((member) => (
                    <div
                      key={member.user.id}
                      className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={member.user.displayName || member.user.name || member.user.email}
                          avatarUrl={member.user.avatarUrl}
                          size="sm"
                        />
                        <div>
                          <span className="font-medium text-[var(--text)]">
                            {member.user.name
                              ? `${member.user.name} ${member.user.surname || ""}`
                              : member.user.email}
                          </span>
                          {member.user.bggUsername && (
                            <a
                              href={`https://boardgamegeek.com/user/${member.user.bggUsername}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors ml-1"
                            >
                              @{member.user.bggUsername}
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Hacer admin: visible para admins/owners, en miembros que no son admin/owner */}
                        {isAdmin && member.role === "member" && member.user.id !== group.currentUserId && (
                          <button
                            onClick={async () => {
                              const name = member.user.displayName || member.user.name || member.user.email;
                              if (!confirm(`¿Hacer admin a ${name}?`)) return;
                              const res = await fetch(`/api/groups/${groupId}/members/${member.user.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ role: "admin" }),
                              });
                              if (res.ok) fetchData();
                              else {
                                const data = await res.json();
                                alert(data.error || "Error al cambiar rol");
                              }
                            }}
                            className="px-2 py-0.5 rounded text-xs font-medium bg-[var(--accent-soft)] text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors"
                          >
                            Hacer admin
                          </button>
                        )}
                        {/* Quitar admin: solo visible para el owner, en admins */}
                        {isOwner && member.role === "admin" && (
                          <button
                            onClick={async () => {
                              const name = member.user.displayName || member.user.name || member.user.email;
                              if (!confirm(`¿Quitar admin a ${name}? Pasará a ser miembro.`)) return;
                              const res = await fetch(`/api/groups/${groupId}/members/${member.user.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ role: "member" }),
                              });
                              if (res.ok) fetchData();
                              else {
                                const data = await res.json();
                                alert(data.error || "Error al cambiar rol");
                              }
                            }}
                            className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                          >
                            Quitar admin
                          </button>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            member.role === "owner"
                              ? "bg-[var(--primary)]/30 text-[var(--primary)]"
                              : member.role === "admin"
                                ? "bg-[var(--accent-soft)] text-[var(--primary)]"
                                : "bg-[var(--surface-hover)] text-[var(--text-secondary)]"
                          }`}
                        >
                          {member.role === "owner" ? "Propietario" : member.role === "admin" ? "Admin" : "Miembro"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Enlace de invitación */}
              <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-6">
                <h2 className="text-lg font-semibold text-[var(--text)] mb-4">Enlace de invitación</h2>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Comparte este enlace para que cualquiera pueda unirse al grupo.
                </p>

                {inviteLinkCode ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`${typeof window !== "undefined" ? window.location.origin : ""}/join/${inviteLinkCode}`}
                        className="flex-1 min-w-0 px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-[var(--text-secondary)] text-xs sm:text-sm font-mono truncate transition-all duration-200"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/join/${inviteLinkCode}`);
                          setInviteLinkCopied(true);
                          setTimeout(() => setInviteLinkCopied(false), 2000);
                        }}
                        className="px-3 py-2 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] font-semibold text-sm whitespace-nowrap transition-all duration-200 shadow-sm hover:shadow-md"
                      >
                        {inviteLinkCopied ? "¡Copiado!" : "Copiar"}
                      </button>
                    </div>

                    {isAdmin && (
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              setInviteLinkLoading(true);
                              try {
                                const res = await fetch(`/api/groups/${groupId}/invite-link`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  credentials: "include",
                                  body: JSON.stringify({ enabled: !inviteLinkEnabled }),
                                });
                                if (res.ok) {
                                  const data = await res.json();
                                  setInviteLinkEnabled(data.inviteEnabled);
                                }
                              } finally {
                                setInviteLinkLoading(false);
                              }
                            }}
                            disabled={inviteLinkLoading}
                            className={`relative w-10 h-5 rounded-full transition-all duration-200 ${
                              inviteLinkEnabled ? "bg-[var(--primary)]" : "bg-[var(--surface-hover)]"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                inviteLinkEnabled ? "translate-x-5" : ""
                              }`}
                            />
                          </button>
                          <span className="text-sm text-[var(--text-secondary)]">
                            {inviteLinkEnabled ? "Activo" : "Desactivado"}
                          </span>
                        </div>

                        <button
                          onClick={async () => {
                            if (!confirm("¿Regenerar el enlace? El anterior dejará de funcionar.")) return;
                            setInviteLinkLoading(true);
                            try {
                              const res = await fetch(`/api/groups/${groupId}/invite-link`, {
                                method: "POST",
                                credentials: "include",
                              });
                              if (res.ok) {
                                const data = await res.json();
                                setInviteLinkCode(data.inviteCode);
                                setInviteLinkEnabled(data.inviteEnabled);
                              }
                            } finally {
                              setInviteLinkLoading(false);
                            }
                          }}
                          disabled={inviteLinkLoading}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-50"
                        >
                          Regenerar enlace
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    {isAdmin ? (
                      <button
                        onClick={async () => {
                          setInviteLinkLoading(true);
                          try {
                            const res = await fetch(`/api/groups/${groupId}/invite-link`, {
                              method: "POST",
                              credentials: "include",
                            });
                            if (res.ok) {
                              const data = await res.json();
                              setInviteLinkCode(data.inviteCode);
                              setInviteLinkEnabled(data.inviteEnabled);
                            }
                          } finally {
                            setInviteLinkLoading(false);
                          }
                        }}
                        disabled={inviteLinkLoading}
                        className="px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] disabled:opacity-50 font-semibold text-sm transition-all duration-200 shadow-sm hover:shadow-md"
                      >
                        {inviteLinkLoading ? "Generando..." : "Generar enlace de invitación"}
                      </button>
                    ) : (
                      <p className="text-sm text-[var(--text-muted)]">
                        No hay enlace de invitación activo. Solo un admin puede generarlo.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-6">
                <h2 className="text-lg font-semibold text-[var(--text)] mb-4">Invitar por email</h2>
                <form onSubmit={handleInvite} className="flex gap-3">
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    className="flex-1 px-4 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl text-[var(--text)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)] focus:outline-none transition-all duration-200"
                  />
                  <button
                    type="submit"
                    disabled={inviting}
                    className="px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] disabled:opacity-50 font-semibold text-sm transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    {inviting ? "Enviando..." : "Invitar"}
                  </button>
                </form>
                {inviteMsg && <p className="text-sm text-green-400 mt-2">{inviteMsg}</p>}
                {inviteError && <p className="text-sm text-red-400 mt-2">{inviteError}</p>}
              </div>

              {group.invitations.length > 0 && (
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-6">
                  <h2 className="text-lg font-semibold text-[var(--text)] mb-4">Invitaciones pendientes</h2>
                  <div className="space-y-2">
                    {group.invitations.map((inv) => (
                      <div
                        key={inv.email}
                        className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0"
                      >
                        <span className="text-sm text-[var(--text-secondary)]">{inv.email}</span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {new Date(inv.createdAt).toLocaleDateString("es-ES")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Zona peligrosa: solo el propietario puede eliminar el grupo ── */}
              {isOwner && (
                <div className="bg-[var(--surface)] rounded-2xl border border-red-500/30 shadow-[var(--card-shadow)] p-6">
                  <h2 className="text-lg font-semibold text-red-400 mb-2">Zona peligrosa</h2>
                  <p className="text-sm text-[var(--text-secondary)] mb-4">
                    Eliminar el grupo borra para siempre todos sus miembros, juegos, votos, sesiones e invitaciones. <strong className="text-[var(--text)]">Esta acción no se puede deshacer.</strong>
                  </p>
                  <button
                    onClick={() => {
                      setDeleteConfirmText("");
                      setDeleteError("");
                      setShowDeleteModal(true);
                    }}
                    className="px-4 py-2.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/20 hover:border-red-500/50 font-semibold text-sm transition-all duration-200"
                  >
                    Eliminar este grupo
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ═══════════ Activity Tab ═══════════ */}
          {/* ═══════════ Galería Tab ═══════════ */}
          {activeTab === "gallery" && group && (
            <GroupGallery
              groupId={groupId}
              currentUserId={group.currentUserId}
              isAdmin={group.currentUserRole === "admin" || group.currentUserRole === "owner"}
              reloadKey={galleryReloadKey}
              onAddOpinion={(gameId, gameName) => setReviewModal({ gameId, gameName, mode: "review" })}
            />
          )}

          {activeTab === "activity" && (
            <div className="space-y-4">
              {/* Podio: 3 juegos más votados ahora mismo (entre los pendientes) */}
              {(() => {
                const topThree = pendingGames.filter((g) => g.score > 0).slice(0, 3);
                if (topThree.length === 0) return null;
                const order: { rank: 1 | 2 | 3; game: RankedGame | undefined }[] = [
                  { rank: 2, game: topThree[1] },
                  { rank: 1, game: topThree[0] },
                  { rank: 3, game: topThree[2] },
                ];
                return (
                  <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-4 sm:p-5">
                    <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-4">
                      🏆 Podio del grupo
                    </h2>
                    <div className="grid grid-cols-3 gap-2 sm:gap-4 items-end">
                      {order.map(({ rank, game }) => {
                        if (!game) {
                          return <div key={`empty-${rank}`} aria-hidden />;
                        }
                        const stepHeight =
                          rank === 1
                            ? "h-14 sm:h-16"
                            : rank === 2
                              ? "h-10 sm:h-12"
                              : "h-7 sm:h-9";
                        const gradient =
                          rank === 1
                            ? "from-amber-300 via-yellow-400 to-amber-600"
                            : rank === 2
                              ? "from-slate-200 via-slate-400 to-slate-500"
                              : "from-amber-600 via-amber-700 to-amber-900";
                        const ring =
                          rank === 1
                            ? "ring-yellow-400/60"
                            : rank === 2
                              ? "ring-slate-400/60"
                              : "ring-amber-700/60";
                        const thumbDim = rank === 1 ? "w-16 h-16 sm:w-20 sm:h-20" : "w-12 h-12 sm:w-16 sm:h-16";
                        return (
                          <button
                            key={game.groupGameId}
                            onClick={() => switchTab("ranking")}
                            className="group/podium flex flex-col items-center text-center min-w-0 cursor-pointer"
                            title={`${game.game.name} · ${game.score} pts`}
                          >
                            <span className="h-6 mb-1 text-xl sm:text-2xl leading-none" aria-hidden>
                              {rank === 1 ? "👑" : ""}
                            </span>
                            <div className={`${thumbDim} rounded-lg overflow-hidden ring-2 ${ring} bg-[var(--surface-hover)] mb-2 transition-transform group-hover/podium:scale-105`}>
                              {game.game.thumbnail ? (
                                <Image
                                  src={game.game.thumbnail}
                                  alt=""
                                  width={80}
                                  height={80}
                                  className="w-full h-full object-cover"
                                  unoptimized
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-xs">?</div>
                              )}
                            </div>
                            <div className="text-[11px] sm:text-sm font-semibold text-[var(--text)] leading-tight line-clamp-2 w-full px-0.5">
                              {game.game.name}
                            </div>
                            <div className="text-[10px] sm:text-xs text-[var(--text-muted)] mt-0.5 mb-2">
                              {game.score} pts
                            </div>
                            <div className={`w-full ${stepHeight} rounded-t-xl bg-gradient-to-b ${gradient} flex items-start justify-center pt-1 sm:pt-1.5`}>
                              <span className="text-white text-base sm:text-lg font-bold drop-shadow">{rank}º</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {stats && (
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-4 sm:p-5">
                  <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
                    El grupo en números
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatTile label="Juegos" value={stats.gamesCount.toLocaleString("es-ES")} />
                    <StatTile label="Partidas" value={stats.playsCount.toLocaleString("es-ES")} />
                    <StatTile
                      label="A la mesa"
                      value={stats.totalMinutes > 0 ? formatDuration(stats.totalMinutes) : "—"}
                    />
                    <StatTile
                      label="Última partida"
                      value={stats.lastPlayedAt ? formatRelativeShort(stats.lastPlayedAt) : "Aún ninguna"}
                    />
                  </div>
                  {stats.topGame && stats.topGame.playCount > 1 && (
                    <div className="mt-4 pt-4 border-t border-[var(--border)] flex items-center gap-3">
                      {stats.topGame.thumbnail ? (
                        <Image
                          src={stats.topGame.thumbnail}
                          alt=""
                          width={40}
                          height={40}
                          className="w-10 h-10 rounded-lg object-cover shrink-0"
                          unoptimized
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-[var(--surface-hover)] shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                          Juego más jugado
                        </div>
                        <div className="text-sm font-medium text-[var(--text)] truncate">
                          {stats.topGame.name}
                          <span className="text-[var(--text-secondary)] font-normal"> · {stats.topGame.playCount} {stats.topGame.playCount === 1 ? "partida" : "partidas"}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-4">
                <h2 className="text-lg font-semibold text-[var(--text)] mb-4">Actividad del grupo</h2>
                <ActivityFeed
                  items={feedItems}
                  onLoadMore={() => feedCursor && fetchGroupFeed(feedCursor)}
                  hasMore={feedHasMore}
                  loading={feedLoading}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {reviewModal && (
        <GameReviewModal
          groupId={groupId}
          gameId={reviewModal.gameId}
          gameName={reviewModal.gameName}
          mode={reviewModal.mode}
          onClose={() => setReviewModal(null)}
          onDone={handleReviewDone}
        />
      )}

      <Footer />
    </>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="text-lg font-semibold text-[var(--text)] tabular-nums">{value}</div>
    </div>
  );
}
