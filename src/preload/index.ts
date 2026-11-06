import { contextBridge, ipcRenderer, webUtils } from 'electron'

const inv =
  (ch: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(ch, ...args)

function on(channel: string, cb: (payload: unknown) => void) {
  const l = (_e: unknown, p: unknown) => cb(p)
  ipcRenderer.on(channel, l)
  return () => ipcRenderer.removeListener(channel, l)
}

const api = {
  app: {
    getSettings: inv('app:getSettings'),
    setSettings: inv('app:setSettings'),
    pickFolder: inv('app:pickFolder'),
    pickImages: inv('app:pickImages'),
    saveTempImage: inv('app:saveTempImage'),
    openPath: inv('app:openPath'),
    showInFolder: inv('app:showInFolder'),
    openExternal: inv('app:openExternal'),
    version: inv('app:version'),
    pathForFile: (f: File) => webUtils.getPathForFile(f)
  },
  project: {
    open: inv('project:open'),
    create: inv('project:create'),
    current: inv('project:current'),
    shelf: inv('project:shelf'),
    readManuscript: inv('project:readManuscript'),
    close: inv('project:close'),
    readFile: inv('project:readFile'),
    writeFile: inv('project:writeFile'),
    deleteFile: inv('project:deleteFile'),
    renameFile: inv('project:renameFile'),
    readScene: inv('project:readScene'),
    readDoc: inv('project:readDoc'),
    writeDoc: inv('project:writeDoc'),
    writeScene: inv('project:writeScene'),
    createChapter: inv('project:createChapter'),
    createScene: inv('project:createScene'),
    renameChapter: inv('project:renameChapter'),
    reorderScenes: inv('project:reorderScenes'),
    moveScene: inv('project:moveScene'),
    saveConfig: inv('project:saveConfig'),
    onChanged: (cb: (p: unknown) => void) => on('project:changed', cb)
  },
  bible: { upsert: inv('bible:upsert') },
  series: {
    addBook: inv('series:addBook'),
    openBook: inv('series:openBook'),
    saveConfig: inv('series:saveConfig'),
    convert: inv('series:convert')
  },
  brainstorm: {
    list: inv('brainstorm:list'),
    create: inv('brainstorm:create'),
    open: inv('brainstorm:open'),
    close: inv('brainstorm:close'),
    saveSession: inv('brainstorm:saveSession'),
    delete: inv('brainstorm:delete'),
    ideas: inv('brainstorm:ideas'),
    writeIdeas: inv('brainstorm:writeIdeas'),
    convert: inv('brainstorm:convert'),
    onChanged: (cb: (p: unknown) => void) => on('brainstorm:changed', cb)
  },
  stats: { get: inv('stats:get') },
  snapshots: { list: inv('snapshots:list'), create: inv('snapshots:create'), restore: inv('snapshots:restore') },
  reports: { list: inv('reports:list') },
  exporter: { run: inv('export:run') },
  sessions: { list: inv('sessions:list'), load: inv('sessions:load'), save: inv('sessions:save'), delete: inv('sessions:delete') },
  commands: { list: inv('commands:list'), expand: inv('commands:expand') },
  auth: { status: inv('auth:status'), login: inv('auth:login') },
  aisync: {
    status: inv('aisync:status'),
    save: inv('aisync:save'),
    load: inv('aisync:load'),
    onResult: (cb: (p: unknown) => void) => on('aisync:result', cb)
  },
  updates: {
    status: inv('updates:status'),
    check: inv('updates:check'),
    download: inv('updates:download'),
    install: inv('updates:install'),
    onStatus: (cb: (p: unknown) => void) => on('updates:status', cb)
  },
  engine: {
    codexModels: inv('engine:codexModels'),
    start: inv('engine:start'),
    send: inv('engine:send'),
    interrupt: inv('engine:interrupt'),
    setMode: inv('engine:setMode'),
    setModel: inv('engine:setModel'),
    setEffort: inv('engine:setEffort'),
    respond: inv('engine:respond'),
    close: inv('engine:close'),
    onEvent: (cb: (p: unknown) => void) => on('engine:event', cb)
  }
}

contextBridge.exposeInMainWorld('novel', api)
export type RawApi = typeof api
