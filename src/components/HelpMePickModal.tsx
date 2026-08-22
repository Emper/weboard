"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import BggRating from "@/components/BggRating";
import { formatDuration } from "@/lib/format";

interface PickerGame {
  bggId: number;
  name: string;
  thumbnail: string | null;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null;
  bggRating: number | null;
  weight: number | null;
}

export interface PickerItem {
  game: PickerGame;
}

interface Props {
  /** Ranking ya ordenado (juegos pendientes). El sorteo usa el 30% superior. */
  games: PickerItem[];
  onClose: () => void;
}

/** Porcentaje superior del ranking que entra en el sorteo. */
const TOP_FRACTION = 0.3;
/** Mínimo de juegos en el bombo (o todos, si el ranking tiene menos). */
const MIN_POOL = 5;
/** Nº de juegos que desfilan por la ruleta antes de parar. */
const TICKS = 22;

const CONFETTI_COLORS = ["#f59e0b", "#fbbf24", "#34d399", "#60a5fa", "#c084fc", "#f87171"];

interface ConfettiPiece {
  left: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  color: string;
  round: boolean;
}

/** Un sorteo concreto: de dónde arranca la ruleta, dónde para y su confeti. */
interface Draw {
  start: number;
  picked: number;
  /** Sin animación: un solo juego o el usuario prefiere menos movimiento. */
  instant: boolean;
  confetti: ConfettiPiece[];
}

/** Nº de juegos que entran en el sorteo: 30% superior, mínimo 5, o todos si hay menos. */
export function getPoolSize(total: number) {
  return Math.min(total, Math.max(MIN_POOL, Math.ceil(total * TOP_FRACTION)));
}

function buildConfetti(): ConfettiPiece[] {
  return Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100,
    size: 6 + Math.random() * 7,
    delay: Math.random() * 0.45,
    duration: 1.9 + Math.random() * 1.4,
    drift: (Math.random() - 0.5) * 180,
    spin: 360 + Math.random() * 720,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: i % 3 === 0,
  }));
}

function newDraw(poolSize: number): Draw {
  const confetti = buildConfetti();
  if (poolSize <= 0) return { start: 0, picked: 0, instant: true, confetti };

  const picked = Math.floor(Math.random() * poolSize);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced || poolSize === 1) return { start: picked, picked, instant: true, confetti };

  // La ruleta avanza un juego por tick, así que arranca TICKS antes del ganador.
  const start = (((picked - TICKS) % poolSize) + poolSize) % poolSize;
  return { start, picked, instant: false, confetti };
}

export default function HelpMePickModal({ games, onClose }: Props) {
  const pool = useMemo(() => games.slice(0, getPoolSize(games.length)), [games]);

  const [state, setState] = useState<{ draw: Draw; tick: number }>(() => {
    const draw = newDraw(pool.length);
    return { draw, tick: draw.instant ? TICKS : 0 };
  });
  const { draw, tick } = state;

  // Cada tick mueve la ruleta un juego, con intervalos crecientes: va frenando.
  useEffect(() => {
    if (draw.instant) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    for (let i = 1; i <= TICKS; i++) {
      elapsed += 45 + 280 * Math.pow(i / TICKS, 3);
      timers.push(
        setTimeout(
          () => setState((s) => (s.draw === draw ? { draw, tick: i } : s)),
          elapsed
        )
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [draw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const spinning = tick < TICKS;
  const index = pool.length
    ? spinning
      ? (draw.start + tick) % pool.length
      : Math.min(draw.picked, pool.length - 1)
    : 0;
  const item = pool[index];

  const repeat = () =>
    setState(() => {
      const next = newDraw(pool.length);
      return { draw: next, tick: next.instant ? TICKS : 0 };
    });

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Confeti: se monta al revelar el ganador y no captura clicks */}
      {!spinning && item && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {draw.confetti.map((p, i) => (
            <span
              key={i}
              className="absolute top-0 animate-confetti"
              style={{
                left: `${p.left}%`,
                width: p.size,
                height: p.round ? p.size : p.size * 1.6,
                background: p.color,
                borderRadius: p.round ? "9999px" : "2px",
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                ["--confetti-drift" as string]: `${p.drift}px`,
                ["--confetti-spin" as string]: `${p.spin}deg`,
              }}
            />
          ))}
        </div>
      )}

      <div
        className="relative bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-[var(--card-shadow)] p-5 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-semibold text-[var(--text)]">🎯 Ayúdame a elegir</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text)]"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)] mb-4">
          {pool.length === games.length
            ? `Sorteo entre los ${pool.length} juego${pool.length !== 1 ? "s" : ""} del ranking`
            : `Sorteo entre los ${pool.length} primeros del ranking`}
        </p>

        {/* Ruleta / resultado */}
        <div
          className={`rounded-2xl border p-4 min-h-[248px] flex flex-col items-center justify-center text-center transition-colors duration-500 ${
            spinning
              ? "border-[var(--border)] bg-[var(--input-bg)]"
              : "border-[var(--primary)]/50 bg-[var(--accent-soft)] animate-glow-pulse"
          }`}
          aria-live="polite"
        >
          {item ? (
            <div
              key={spinning ? `spin-${index}` : `winner-${index}`}
              className={spinning ? "animate-reel-tick" : "animate-winner-pop"}
            >
              <div className="w-[104px] h-[104px] mx-auto rounded-xl overflow-hidden bg-[var(--surface-hover)]">
                {item.game.thumbnail ? (
                  <Image
                    src={item.game.thumbnail}
                    alt={item.game.name}
                    width={130}
                    height={130}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-xl">
                    🎲
                  </div>
                )}
              </div>
              <p className="mt-3 font-semibold text-[var(--text)] text-base sm:text-lg leading-tight">
                {spinning ? (
                  item.game.name
                ) : (
                  <a
                    href={`https://boardgamegeek.com/boardgame/${item.game.bggId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[var(--primary)] transition-colors"
                  >
                    {item.game.name}
                  </a>
                )}
                {item.game.yearPublished && (
                  <span className="text-[var(--text-muted)] font-normal ml-1 text-xs">
                    ({item.game.yearPublished})
                  </span>
                )}
              </p>
              {spinning ? (
                <p className="mt-2 text-xs text-[var(--text-muted)]">Sorteando…</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2">
                    {item.game.bggRating && <BggRating rating={item.game.bggRating} size={30} />}
                    {item.game.playingTime && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-emerald-500/20 text-emerald-300">
                        ⏱ {formatDuration(item.game.playingTime)}
                      </span>
                    )}
                    {item.game.weight && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-purple-500/20 text-purple-300">
                        ⚖️ {item.game.weight.toFixed(1)}
                      </span>
                    )}
                    {(item.game.minPlayers || item.game.maxPlayers) && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-[var(--surface-hover)] text-[var(--text-secondary)]">
                        {item.game.minPlayers === item.game.maxPlayers
                          ? `${item.game.minPlayers}p`
                          : `${item.game.minPlayers || "?"}-${item.game.maxPlayers || "?"}p`}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-[var(--primary)]">
                    🎉 ¡Esta es vuestra partida!
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Puesto #{index + 1} del ranking
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              No hay juegos pendientes para sortear.
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={repeat}
            disabled={spinning || pool.length === 0}
            className="flex-1 px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl hover:bg-[var(--primary-hover)] disabled:opacity-50 font-semibold text-sm transition-all duration-200 shadow-sm hover:shadow-md"
          >
            🎲 Repetir sorteo
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] font-semibold text-sm transition-all duration-200"
          >
            Cerrar
          </button>
        </div>
        <p className="mt-3 text-[11px] text-[var(--text-muted)] text-center">
          Es solo una sugerencia: no se marca nada como jugado.
        </p>
      </div>
    </div>
  );
}
