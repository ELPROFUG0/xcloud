import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, BaseDirectory } from "@tauri-apps/plugin-fs";


import { updateAgentAvatar } from "@/lib/update-identity";

// Gradient avatars
const avatarModules = import.meta.glob("@/assets/avatars/avatar-*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const GRADIENT_AVATARS = Object.values(avatarModules).sort();

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onSelectImage?: (path: string) => void;
  agentId?: string;
  onClose: () => void;
}

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Faces",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊",
      "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😋", "😛", "😜",
      "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐",
      "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪",
      "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🥵", "🥶", "🥴",
      "😵", "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐", "😕", "😟",
      "🙁", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰",
      "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫",
      "🥱", "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "☠️", "💩",
      "🤡", "👹", "👺", "👻", "👽", "👾", "🤖",
    ],
  },
  {
    label: "People",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞",
      "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍",
      "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝",
      "🙏", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🧠",
      "🫀", "🫁", "🦷", "🦴", "👀", "👁️", "👅", "👄", "🫦", "👶",
      "🧒", "👦", "👧", "🧑", "👱", "👨", "🧔", "👩", "🧓", "👴",
      "👵", "🙍", "🙎", "🙅", "🙆", "💁", "🙋", "🧏", "🙇", "🤦",
      "🤷", "👮", "🕵️", "💂", "🥷", "👷", "🤴", "👸", "👳", "👲",
      "🧕", "🤵", "👰", "🤰", "🫃", "🫄", "🤱", "👼", "🎅", "🤶",
      "🦸", "🦹", "🧙", "🧚", "🧛", "🧜", "🧝", "🧞", "🧟", "🧌",
    ],
  },
  {
    label: "Animals",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨",
      "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒",
      "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇",
      "🐺", "🐗", "🐴", "🦄", "🐝", "🪱", "🐛", "🦋", "🐌", "🐞",
      "🐜", "🪰", "🪲", "🪳", "🦟", "🦗", "🕷️", "🦂", "🐢", "🐍",
      "🦎", "🦖", "🦕", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠",
      "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍",
      "🦧", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒", "🦘", "🦬", "🐃",
      "🐂", "🐄", "🐎", "🐖", "🐏", "🐑", "🦙", "🐐", "🦌", "🐕",
      "🐩", "🦮", "🐕‍🦺", "🐈", "🐈‍⬛", "🪶", "🐓", "🦃", "🦤", "🦚",
      "🦜", "🦢", "🦩", "🕊️", "🐇", "🦝", "🦨", "🦡", "🦫", "🦦",
      "🦥", "🐁", "🐀", "🐿️", "🦔", "🐉", "🐲",
    ],
  },
  {
    label: "Nature",
    emojis: [
      "🌵", "🎄", "🌲", "🌳", "🌴", "🪵", "🌱", "🌿", "☘️", "🍀",
      "🎍", "🪴", "🎋", "🍃", "🍂", "🍁", "🪺", "🪹", "🍄", "🌾",
      "💐", "🌷", "🌹", "🥀", "🌺", "🌸", "🌼", "🌻", "🌞", "🌝",
      "🌛", "🌜", "🌚", "🌕", "🌖", "🌗", "🌘", "🌑", "🌒", "🌓",
      "🌔", "🌙", "🌎", "🌍", "🌏", "🪐", "💫", "⭐", "🌟", "✨",
      "⚡", "☄️", "💥", "🔥", "🌪️", "🌈", "☀️", "🌤️", "⛅", "🌥️",
      "☁️", "🌦️", "🌧️", "⛈️", "🌩️", "🌨️", "❄️", "☃️", "⛄", "🌬️",
      "💨", "💧", "💦", "🫧", "☔", "🌊", "🌫️",
    ],
  },
  {
    label: "Objects",
    emojis: [
      "⌚", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🖲️", "🕹️",
      "🗜️", "💽", "💾", "💿", "📀", "📼", "📷", "📸", "📹", "🎥",
      "📽️", "🎞️", "📞", "☎️", "📟", "📠", "📺", "📻", "🎙️", "🎚️",
      "🎛️", "🧭", "⏱️", "⏲️", "⏰", "🕰️", "⌛", "⏳", "📡", "🔋",
      "🪫", "🔌", "💡", "🔦", "🕯️", "🪔", "🧯", "🗑️", "🛢️", "💸",
      "💵", "💴", "💶", "💷", "🪙", "💰", "💳", "💎", "⚖️", "🪜",
      "🧰", "🪛", "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🪚", "🔩", "⚙️",
      "🪤", "🧱", "⛓️", "🧲", "🔫", "💣", "🧨", "🪓", "🔪", "🗡️",
      "⚔️", "🛡️", "🚬", "⚰️", "🪦", "⚱️", "🏺", "🔮", "📿", "🧿",
      "🪬", "💈", "⚗️", "🔭", "🔬", "🕳️", "🩹", "🩺", "🩻", "🩼",
      "💊", "💉", "🩸", "🧬", "🦠", "🧫", "🧪", "🌡️", "🧹", "🪠",
      "🧺", "🧻", "🚽", "🚰", "🚿", "🛁", "🛀", "🧼", "🪥", "🪒",
      "🧽", "🪣", "🔑", "🗝️", "🚪", "🪑", "🛋️", "🛏️", "🛌", "🧸",
    ],
  },
  {
    label: "Symbols",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
      "💟", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️",
      "☦️", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎",
      "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️", "🉑", "☢️", "☣️",
      "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "💮",
      "🉐", "㊙️", "㊗️", "🈴", "🈵", "🈹", "🈲", "🅰️", "🅱️", "🆎",
      "🆑", "🅾️", "🆘", "❌", "⭕", "🛑", "⛔", "📛", "🚫", "💯",
      "💢", "♨️", "🚷", "🚯", "🚳", "🚱", "🔞", "📵", "🚭", "❗",
      "❕", "❓", "❔", "‼️", "⁉️", "🔅", "🔆", "〽️", "⚠️", "🚸",
      "🔱", "⚜️", "🔰", "♻️", "✅", "🈯", "💹", "❇️", "✳️", "❎",
      "🌐", "💠", "Ⓜ️", "🌀", "💤", "🏧", "🚾", "♿", "🅿️", "🛗",
    ],
  },
  {
    label: "Food",
    emojis: [
      "🍇", "🍈", "🍉", "🍊", "🍋", "🍌", "🍍", "🥭", "🍎", "🍏",
      "🍐", "🍑", "🍒", "🍓", "🫐", "🥝", "🍅", "🫒", "🥥", "🥑",
      "🍆", "🥔", "🥕", "🌽", "🌶️", "🫑", "🥒", "🥬", "🥦", "🧄",
      "🧅", "🥜", "🫘", "🌰", "🫚", "🫛", "🍞", "🥐", "🥖", "🫓",
      "🥨", "🥯", "🥞", "🧇", "🧀", "🍖", "🍗", "🥩", "🥓", "🍔",
      "🍟", "🍕", "🌭", "🥪", "🌮", "🌯", "🫔", "🥙", "🧆", "🥚",
      "🍳", "🥘", "🍲", "🫕", "🥣", "🥗", "🍿", "🧈", "🧂", "🥫",
      "🍱", "🍘", "🍙", "🍚", "🍛", "🍜", "🍝", "🍠", "🍢", "🍣",
      "🍤", "🍥", "🥮", "🍡", "🥟", "🥠", "🥡", "🦀", "🦞", "🦐",
      "🦑", "🦪", "🍦", "🍧", "🍨", "🍩", "🍪", "🎂", "🍰", "🧁",
      "🥧", "🍫", "🍬", "🍭", "🍮", "🍯", "🍼", "🥛", "☕", "🫖",
      "🍵", "🍶", "🍾", "🍷", "🍸", "🍹", "🍺", "🍻", "🥂", "🥃",
    ],
  },
  {
    label: "Travel",
    emojis: [
      "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐",
      "🛻", "🚚", "🚛", "🚜", "🏍️", "🛵", "🚲", "🛴", "🛹", "🛼",
      "🚁", "🛸", "🚀", "🛩️", "✈️", "🛫", "🛬", "🪂", "💺", "🚂",
      "🚃", "🚄", "🚅", "🚆", "🚇", "🚈", "🚉", "🚊", "🚝", "🚞",
      "⛵", "🚤", "🛥️", "🛳️", "⛴️", "🚢", "⚓", "🪝", "⛽", "🚧",
      "🗿", "🗽", "🗼", "🏰", "🏯", "🏟️", "🎡", "🎢", "🎠", "⛲",
      "⛱️", "🏖️", "🏝️", "🏜️", "🌋", "⛰️", "🏔️", "🗻", "🏕️", "⛺",
      "🏠", "🏡", "🏘️", "🏚️", "🏗️", "🏭", "🏢", "🏬", "🏣", "🏤",
      "🏥", "🏦", "🏨", "🏪", "🏫", "🏩", "💒", "🏛️", "⛪", "🕌",
      "🕍", "🛕", "🕋", "⛩️", "🛤️", "🛣️", "🗺️", "🧭", "⛰️",
    ],
  },
  {
    label: "Activities",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱",
      "🪀", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "⛳",
      "🪁", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🛷",
      "⛸️", "🥌", "🎿", "⛷️", "🏂", "🪂", "🏋️", "🤼", "🤸", "⛹️",
      "🤺", "🤾", "🏌️", "🏇", "🧘", "🏄", "🏊", "🤽", "🚣", "🧗",
      "🚵", "🚴", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️", "🎗️",
      "🎫", "🎟️", "🎪", "🤹", "🎭", "🩰", "🎨", "🎬", "🎤", "🎧",
      "🎼", "🎹", "🥁", "🪘", "🎷", "🎺", "🪗", "🎸", "🪕", "🎻",
      "🪈", "🎲", "♟️", "🎯", "🎳", "🎮", "🎰", "🧩",
    ],
  },
  {
    label: "Flags",
    emojis: [
      "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️", "🇦🇷", "🇧🇷",
      "🇨🇦", "🇨🇳", "🇨🇴", "🇩🇪", "🇪🇸", "🇫🇷", "🇬🇧", "🇮🇳", "🇮🇹", "🇯🇵",
      "🇰🇷", "🇲🇽", "🇳🇱", "🇵🇹", "🇷🇺", "🇸🇦", "🇹🇷", "🇺🇦", "🇺🇸", "🇻🇪",
    ],
  },
];

const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap(c => c.emojis);

export function EmojiPicker({ onSelect, onSelectImage, agentId, onClose }: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!search.trim()) return null;
    // Simple search — match emoji by checking if the search string is an emoji itself
    // or filter by unicode name approximation
    const q = search.toLowerCase().trim();
    return ALL_EMOJIS.filter(e => e.includes(q) || e === q);
  }, [search]);

  const handleImageUpload = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
    });

    if (!selected) return;

    const filePath = typeof selected === "string" ? selected : (selected as unknown as { path: string }).path;
    if (!filePath) return;

    const ext = filePath.split(".").pop() ?? "png";
    const destDir = agentId && agentId !== "main"
      ? `.openclaw/workspace/${agentId}`
      : ".openclaw/workspace";
    const destPath = `${destDir}/avatar.${ext}`;

    try {
      await copyFile(filePath, destPath, { toPathBaseDir: BaseDirectory.Home });
      if (agentId) await updateAgentAvatar(agentId, `avatar.${ext}`);
      onSelectImage?.(destPath);
    } catch {
      if (agentId) await updateAgentAvatar(agentId, filePath);
      onSelectImage?.(filePath);
    }

    onClose();
  }, [agentId, onSelectImage, onClose]);

  return (
    <div
      ref={ref}
      className="w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out]"
    >
      {/* Emoji grid with search inside */}
      <div className="max-h-72 overflow-y-auto overscroll-contain">
        {/* Search — sticky at top */}
        <div className="sticky top-0 z-20 px-2 pt-2 pb-1" style={{ backgroundColor: "#181818" }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emojis..."
            className="w-full rounded-lg bg-container px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-text-muted"
            autoFocus
          />
        </div>
        {/* Gradient avatars — shown when no search */}
        {filtered === null && GRADIENT_AVATARS.length > 0 && (
          <div>
            <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-text-muted/60">
              Avatars
            </div>
            <div className="grid grid-cols-8 gap-1.5 px-2 pb-2">
              {GRADIENT_AVATARS.map((src, i) => (
                <button
                  key={`avatar-${i}`}
                  onClick={async () => {
                    if (agentId) {
                      try {
                        const destDir = agentId !== "main" ? `.openclaw/workspace/${agentId}` : ".openclaw/workspace";
                        const destPath = `${destDir}/avatar.jpg`;

                        // Fetch bundled image → write via Tauri FS
                        const resp = await fetch(src);
                        const buffer = new Uint8Array(await (await resp.blob()).arrayBuffer());

                        const { writeFile, mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
                        try { await mkdir(destDir, { baseDir: BaseDirectory.Home, recursive: true }); } catch {}
                        await writeFile(destPath, buffer, { baseDir: BaseDirectory.Home });
                        await updateAgentAvatar(agentId, "avatar.jpg");
                        onSelectImage?.(destPath);
                      } catch {
                        // Fallback: just update IDENTITY.md to point to the bundled URL
                        try {
                          await updateAgentAvatar(agentId, src);
                          onSelectImage?.(src);
                        } catch {}
                      }
                    }
                    onClose();
                  }}
                  className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full transition-transform hover:scale-110 ring-1 ring-white/10"
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {filtered !== null ? (
          /* Search results */
          filtered.length > 0 ? (
            <div className="grid grid-cols-9 gap-0.5 px-2 pb-1">
              {filtered.map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  onClick={() => onSelect(emoji)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-base transition-colors hover:bg-white/10"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-[11px] text-text-muted">No emojis found</div>
          )
        ) : (
          /* Categories */
          EMOJI_CATEGORIES.map((cat) => (
            <div key={cat.label}>
              <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-text-muted/60">
                {cat.label}
              </div>
              <div className="grid grid-cols-9 gap-0.5 px-2 pb-1">
                {cat.emojis.map((emoji, i) => (
                  <button
                    key={`${emoji}-${i}`}
                    onClick={() => onSelect(emoji)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-base transition-colors hover:bg-white/10"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Upload image — bottom */}
      <div className="border-t border-border p-2">
        <button
          onClick={handleImageUpload}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-container px-3 py-2 text-xs text-text transition-colors hover:bg-surface-hover"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-3.5 w-3.5 text-text" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 16L7.46967 11.5303C7.80923 11.1908 8.26978 11 8.75 11C9.23022 11 9.69077 11.1908 10.0303 11.5303L14 15.5M15.5 17L14 15.5M21 16L18.5303 13.5303C18.1908 13.1908 17.7302 13 17.25 13C16.7698 13 16.3092 13.1908 15.9697 13.5303L14 15.5" />
            <path d="M15.5 8C15.7761 8 16 7.77614 16 7.5C16 7.22386 15.7761 7 15.5 7M15.5 8C15.2239 8 15 7.77614 15 7.5C15 7.22386 15.2239 7 15.5 7M15.5 8V7" />
            <path d="M3.69797 19.7472C2.5 18.3446 2.5 16.2297 2.5 12C2.5 7.77027 2.5 5.6554 3.69797 4.25276C3.86808 4.05358 4.05358 3.86808 4.25276 3.69797C5.6554 2.5 7.77027 2.5 12 2.5C16.2297 2.5 18.3446 2.5 19.7472 3.69797C19.9464 3.86808 20.1319 4.05358 20.302 4.25276C21.5 5.6554 21.5 7.77027 21.5 12C21.5 16.2297 21.5 18.3446 20.302 19.7472C20.1319 19.9464 19.9464 20.1319 19.7472 20.302C18.3446 21.5 16.2297 21.5 12 21.5C7.77027 21.5 5.6554 21.5 4.25276 20.302C4.05358 20.1319 3.86808 19.9464 3.69797 19.7472Z" />
          </svg>
          <span>Upload image</span>
        </button>
      </div>
    </div>
  );
}
