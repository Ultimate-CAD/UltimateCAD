import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeLayerlingMcpCommand,
  dispatchLayerlingMcpCommand,
  pollLayerlingMcpCommand,
  registerLayerlingMcpEditor,
  waitForLayerlingMcpCommand,
} from "@/lib/layerlingMcpStore";

const editor = {
  editorId: "editor-test",
  editorNumber: 12345,
  projectId: "project-test",
  projectName: "MCP test",
  url: "http://localhost:3000/?editor=1",
  focused: true,
  shapeCount: 0,
  selectedCount: 0,
  notice: "",
  lastError: null,
};

beforeEach(() => {
  delete (globalThis as { __layerlingMcpStore?: unknown }).__layerlingMcpStore;
  registerLayerlingMcpEditor(editor);
});

describe("Layerling MCP long polling", () => {
  it("allows a bounded mesh hollow operation to complete beyond the ordinary one-minute cap", async () => {
    vi.useFakeTimers();
    try {
      const result = dispatchLayerlingMcpCommand({ editorId: editor.editorId, action: "hollow_object", timeoutMs: 300000 });
      const command = pollLayerlingMcpCommand(editor.editorId)!;
      let settled=false;void result.then(()=>{settled=true;});
      for(let i=0;i<6;i++){await vi.advanceTimersByTimeAsync(10000);registerLayerlingMcpEditor(editor);}
      await vi.advanceTimersByTimeAsync(1000);registerLayerlingMcpEditor(editor);
      expect(settled).toBe(false);
      completeLayerlingMcpCommand(editor.editorId,{commandId:command.id,ok:true,data:{method:"mesh-sdf"}});
      await expect(result).resolves.toMatchObject({ok:true,data:{method:"mesh-sdf"}});
    } finally {vi.useRealTimers();}
  });
  it("delivers a command directly to a waiting editor", async () => {
    const poll = waitForLayerlingMcpCommand(editor.editorId, { timeoutMs: 5_000 });
    const result = dispatchLayerlingMcpCommand({ editorId: editor.editorId, action: "list_objects" });

    const command = await poll;
    expect(command).toMatchObject({ action: "list_objects", params: {} });
    expect(pollLayerlingMcpCommand(editor.editorId)).toBeNull();

    completeLayerlingMcpCommand(editor.editorId, { commandId: command!.id, ok: true, data: [] });
    await expect(result).resolves.toMatchObject({ commandId: command!.id, ok: true, data: [] });
  });

  it("allows only one pending poll per editor", async () => {
    const firstPoll = waitForLayerlingMcpCommand(editor.editorId, { timeoutMs: 5_000 });
    const secondPoll = waitForLayerlingMcpCommand(editor.editorId, { timeoutMs: 5_000 });

    await expect(firstPoll).resolves.toBeNull();
    const result = dispatchLayerlingMcpCommand({ editorId: editor.editorId, action: "inspect_errors" });
    const command = await secondPoll;
    expect(command?.action).toBe("inspect_errors");

    completeLayerlingMcpCommand(editor.editorId, { commandId: command!.id, ok: true });
    await expect(result).resolves.toMatchObject({ commandId: command!.id, ok: true });
  });

  it("removes an aborted poll before queueing the next command", async () => {
    const controller = new AbortController();
    const poll = waitForLayerlingMcpCommand(editor.editorId, { timeoutMs: 5_000, signal: controller.signal });
    controller.abort();
    await expect(poll).resolves.toBeNull();

    const result = dispatchLayerlingMcpCommand({ editorId: editor.editorId, action: "get_scene" });
    const command = pollLayerlingMcpCommand(editor.editorId);
    expect(command?.action).toBe("get_scene");

    completeLayerlingMcpCommand(editor.editorId, { commandId: command!.id, ok: true });
    await expect(result).resolves.toMatchObject({ commandId: command!.id, ok: true });
  });
});
