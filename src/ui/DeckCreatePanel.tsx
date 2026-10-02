import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAppState } from "@/app/AppState";
import type { Deck } from "@/data/dataModels";
import { createLocalDeck } from "@/data/deckCreation";
import { fetchCuriosaDeck } from "@/data/curiosaService";
import { importDeckFromText, importFromCuriosaDeck, type ImportResult } from "@/data/importExport";
import { AVATAR_SHORT_NAMES, getAvatarShortName } from "@/ui/deckDisplay";

type CreateMode = "menu" | "import" | "local" | "text";

interface DeckCreatePanelProps {
  onCreateDeck: (deck: Deck) => boolean;
}

/** Shared creation flow for the side panel and bottom Deck Lookup panel. */
export function DeckCreatePanel({ onCreateDeck }: DeckCreatePanelProps) {
  const { state, dispatch } = useAppState();
  const [mode, setMode] = useState<CreateMode>("menu");
  const [avatarName, setAvatarName] = useState("Animist");
  const [localName, setLocalName] = useState("Animist Deck");
  const [deckUrl, setDeckUrl] = useState("");
  const [deckText, setDeckText] = useState("");
  const [textName, setTextName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const avatarNames = useMemo(() => {
    const names = state.cards.filter((card) => card.guardian.type === "Avatar").map((card) => card.name);
    return (names.length > 0 ? names : Object.keys(AVATAR_SHORT_NAMES)).sort((a, b) => a.localeCompare(b));
  }, [state.cards]);

  useEffect(() => () => {
    importAbortRef.current?.abort();
    importAbortRef.current = null;
  }, []);

  function chooseMode(next: CreateMode) {
    setError(null);
    setNotice(null);
    setMode(next);
  }

  function finishImport(result: ImportResult) {
    if (onCreateDeck({ ...result.deck, origin: 'user' }) === false) {
      setError("The deck could not be added. Please try again.");
      return;
    }
    const unknown = state.cards.length > 0 ? result.unknownCards : [];
    if (unknown.length > 0) {
      const suffix = unknown.length > 4 ? `, +${unknown.length - 4} more` : "";
      dispatch({ type: "ADD_NOTIFICATION", notification: {
        type: "warning",
        message: `Imported deck contains ${unknown.length} unknown card ${unknown.length === 1 ? "name" : "names"}: ${unknown.slice(0, 4).join(", ")}${suffix}`,
      } });
    }
    if (result.warnings.length > 0) {
      dispatch({ type: "ADD_NOTIFICATION", notification: {
        type: "warning", message: result.warnings.slice(0, 3).join(" · "),
      } });
    }
  }

  async function importUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !deckUrl.trim()) return;
    const controller = new AbortController();
    importAbortRef.current = controller;
    setLoading(true);
    setError(null);
    setNotice(null);
    const waitingMessage = "Fetching your deck from SorceryTCG. Requests are spaced to respect its limits.";
    const timer = setTimeout(() => {
      if (importAbortRef.current === controller && !controller.signal.aborted) setNotice(waitingMessage);
    }, 1000);
    try {
      const fetched = await fetchCuriosaDeck(deckUrl.trim(), {
        signal: controller.signal,
        onDelay: () => {
          if (importAbortRef.current === controller && !controller.signal.aborted) setNotice(waitingMessage);
        },
      });
      if (controller.signal.aborted || importAbortRef.current !== controller) return;
      finishImport(importFromCuriosaDeck({
        id: fetched.id, name: fetched.name, author: fetched.author ?? "", ...fetched.boards,
      }, state.cards));
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) return;
      setError(cause instanceof Error ? cause.message : "Failed to load deck");
    } finally {
      clearTimeout(timer);
      if (importAbortRef.current === controller) {
        importAbortRef.current = null;
        setLoading(false);
        setNotice(null);
      }
    }
  }

  function cancelImport() {
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setLoading(false);
    setNotice(null);
  }

  function createLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!localName.trim() || !avatarName) return;
    finishImport({ deck: createLocalDeck({ name: localName, avatarName }), unknownCards: [], warnings: [] });
  }

  function importText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deckText.trim()) return;
    const result = importDeckFromText(deckText.trim(), textName.trim() || "Imported Deck", state.cards);
    if (!(["mainboard", "avatar", "collection", "maybeboard"] as const).some((board) => result.deck.boards[board].length > 0)) {
      setError("No cards found in the pasted text");
      return;
    }
    finishImport(result);
  }

  if (mode === "menu") return (
    <div className="deck-create-menu">
      <button type="button" className="deck-create-choice" onClick={() => chooseMode("import")}>Import deck URL</button>
      <button type="button" className="deck-create-choice" onClick={() => chooseMode("local")}>New local deck</button>
      <button type="button" className="deck-create-choice" onClick={() => chooseMode("text")}>Paste deck text</button>
    </div>
  );

  return (
    <form className="deck-create-form" onSubmit={mode === "import" ? importUrl : mode === "local" ? createLocal : importText}>
      {mode === "import" && (
        <label className="deck-create-field">
          <span>Deck URL or ID</span>
          <input type="text" value={deckUrl} placeholder="https://sorcerytcg.com/decks/..." disabled={loading}
            onChange={(event) => { setDeckUrl(event.target.value); setError(null); }} />
        </label>
      )}
      {mode === "local" && (
        <>
          <label className="deck-create-field">
            <span>Avatar</span>
            <select value={avatarName} onChange={(event) => {
              const next = event.target.value;
              setLocalName((previous) => !previous.trim() || previous === `${getAvatarShortName(avatarName)} Deck`
                ? `${getAvatarShortName(next)} Deck` : previous);
              setAvatarName(next);
            }}>
              {avatarNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="deck-create-field">
            <span>Name</span>
            <input type="text" value={localName} placeholder="Deck name" onChange={(event) => setLocalName(event.target.value)} />
          </label>
        </>
      )}
      {mode === "text" && (
        <>
          <label className="deck-create-field">
            <span>Name</span>
            <input type="text" value={textName} placeholder="Imported Deck" onChange={(event) => setTextName(event.target.value)} />
          </label>
          <label className="deck-create-field">
            <span>Deck list</span>
            <textarea value={deckText} placeholder={"2 Lightning Bolt\n// Collection\n1 Riptide"} spellCheck={false}
              onChange={(event) => { setDeckText(event.target.value); setError(null); }} />
          </label>
        </>
      )}
      <div className="deck-create-actions">
        <button type="submit" disabled={loading || !(mode === "import" ? deckUrl.trim() : mode === "local" ? localName.trim() : deckText.trim())}>
          {loading ? "Loading..." : mode === "import" ? "Load" : mode === "local" ? "Create" : "Import"}
        </button>
        <button type="button" onClick={loading ? cancelImport : () => chooseMode("menu")}>{loading ? "Cancel" : "Back"}</button>
      </div>
      {notice && <p className="deck-create-note deck-import-notice" role="status">{notice}</p>}
      {error && <p className="deck-create-note error" role="alert">{error}</p>}
    </form>
  );
}
