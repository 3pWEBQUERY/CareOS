"use client";

import {
  File,
  FileArchive,
  FileAudio,
  FileCsv,
  FileDoc,
  FileImage,
  FilePdf,
  FilePpt,
  FileText,
  FileVideo,
  FileXls,
  FolderSimple,
  NotePencil,
} from "@phosphor-icons/react";
import { fileKind } from "@/lib/files-shared";

// Farbige Dateisymbole je Art (wie im Dateibereich eines Teams), Ordner in Markenblau.
const ICONS = {
  Bild: { Icon: FileImage, tone: "image" },
  Video: { Icon: FileVideo, tone: "media" },
  Audio: { Icon: FileAudio, tone: "media" },
  PDF: { Icon: FilePdf, tone: "pdf" },
  Word: { Icon: FileDoc, tone: "word" },
  Excel: { Icon: FileXls, tone: "excel" },
  PowerPoint: { Icon: FilePpt, tone: "ppt" },
  Liste: { Icon: FileCsv, tone: "excel" },
  Notiz: { Icon: NotePencil, tone: "note" },
  Archiv: { Icon: FileArchive, tone: "plain" },
  Text: { Icon: FileText, tone: "note" },
} as const;

export function FileIcon({ file, large }: { file: { name: string; mimeType: string }; large?: boolean }) {
  const kind = fileKind(file);
  const { Icon, tone } = ICONS[kind as keyof typeof ICONS] ?? { Icon: File, tone: "plain" };
  return (
    <span className={`files-icon tone-${tone} ${large ? "large" : ""}`} aria-hidden="true">
      <Icon weight="duotone" />
    </span>
  );
}

export function FolderIcon({ large }: { large?: boolean }) {
  return (
    <span className={`files-icon tone-folder ${large ? "large" : ""}`} aria-hidden="true">
      <FolderSimple weight="fill" />
    </span>
  );
}
