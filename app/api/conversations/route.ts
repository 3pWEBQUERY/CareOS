import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import {
  addMembers,
  chatPayload,
  conversationList,
  createConversation,
  deleteMessage,
  editMessage,
  pinMessage,
  removeMember,
  renameConversation,
  sendMessage,
  toggleReaction,
  updateMembership,
  uploadChatFile,
} from "@/lib/messenger";
import { carecoreActor, carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Der Messenger steht allen Mitarbeitenden offen; Zugriff auf eine Unterhaltung haben nur ihre Mitglieder.
async function context() {
  const actor = await carecoreActor();
  if (!actor?.organizationId) return null;
  return { actor: { ...actor, organizationId: actor.organizationId }, sql: carecoreDb() };
}

const unauthorized = () => NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });

export async function GET(request: Request) {
  try {
    const ctx = await context();
    if (!ctx) return unauthorized();
    const params = new URL(request.url).searchParams;
    if (params.get("list") === "1") return NextResponse.json({ conversations: await conversationList(ctx) });
    return NextResponse.json(await chatPayload(ctx, params.get("conversationId")));
  } catch (error) {
    return apiErrorResponse(error, "Nachrichten konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await context();
    if (!ctx) return unauthorized();
    // Datei vom Gerät in eine Unterhaltung hochladen (multipart: conversationId, file).
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
      const form = await request.formData();
      return NextResponse.json(
        { file: await uploadChatFile(ctx, form.get("conversationId"), form.get("file")) },
        { status: 201 },
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    switch (body.action) {
      case "message": {
        const sent = await sendMessage(ctx, body.conversationId, body.text, {
          replyToId: body.replyToId,
          priority: body.priority,
          attachmentIds: body.attachmentIds,
        });
        return NextResponse.json({ ok: true, ...sent }, { status: 201 });
      }
      case "react":
        return NextResponse.json(await toggleReaction(ctx, body.messageId, body.emoji));
      case "edit":
        await editMessage(ctx, body.messageId, body.text);
        return NextResponse.json({ ok: true });
      case "delete":
        await deleteMessage(ctx, body.messageId);
        return NextResponse.json({ ok: true });
      case "pin":
        await pinMessage(ctx, body.messageId, body.pinned === true);
        return NextResponse.json({ ok: true });
      case "membership":
        await updateMembership(ctx, body.conversationId, body);
        return NextResponse.json({ ok: true });
      case "rename":
        await renameConversation(ctx, body.conversationId, body.title);
        return NextResponse.json({ ok: true });
      case "addMembers":
        await addMembers(ctx, body.conversationId, body.memberIds);
        return NextResponse.json({ ok: true });
      case "removeMember":
        await removeMember(ctx, body.conversationId, body.userId);
        return NextResponse.json({ ok: true });
      case "conversation": {
        const created = await createConversation(ctx, body);
        return NextResponse.json(created, { status: created.existing ? 200 : 201 });
      }
      default:
        return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
    }
  } catch (error) {
    return apiErrorResponse(error, "Die Nachricht konnte nicht gespeichert werden.");
  }
}
