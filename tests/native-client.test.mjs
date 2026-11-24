import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('execution snapshot reads native lifecycle only for the requested conversation',()=>{
  let snapshot={conversationId:'current',status:2,turns:[{startStepIndex:7}],executorMetadata:{terminationReason:0}};
  const value={cascadeContext:{state:{agentStateProvider:{getState:()=>snapshot}}}};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value},return:null}};
  const context=vm.createContext({document:{querySelector:()=>element}});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.__agyNativeAdapter.executionState('current'))),{conversationId:'current',status:2,turnStartStepIndex:7,terminationReason:0});
  assert.equal(context.__agyNativeAdapter.executionState('other'),null);
  snapshot={...snapshot,turns:[]};assert.equal(context.__agyNativeAdapter.executionState('current'),null);
});

test('executionState surfaces SYSTEM_MESSAGE wakeup origin, notFullyIdle, and active subagents',()=>{
  const summaries={
    main:{notFullyIdle:true},
    'sub-1':{parentConversationId:'main',status:2,trajectoryMetadata:{subagentSpec:{role:'UI Verification'}}},
    'sub-done':{parentConversationId:'main',status:1,trajectoryMetadata:{subagentSpec:{role:'Finished Check'}}}
  };
  const reduxStore={getState:()=>({trajectorySummaries:{summaries}}),dispatch(){}};
  const snapshot={
    conversationId:'main',status:1,
    turns:[{startStepIndex:10},{startStepIndex:12}],
    executorMetadata:{terminationReason:4},
    trajectorySlice:{
      stepsSlice:{startIndex:10},
      stepsInSlice:[
        {step:{case:'userInput',value:{}}},
        {step:{case:'plannerResponse',value:{response:'Working'}}},
        {step:{case:'systemMessage',value:{}}},
        {step:{case:'plannerResponse',value:{response:'Dispatched'}}}
      ]
    }
  };
  const element={
    '__reactFiber$fixture':{
      tag:10,type:{},memoizedProps:{value:{store:reduxStore}},
      return:{tag:10,type:{},memoizedProps:{value:{cascadeContext:{state:{agentStateProvider:{getState:()=>snapshot}}}}},return:null}
    }
  };
  const context=vm.createContext({document:{querySelector:()=>element,querySelectorAll:()=>[element]}});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const ex=JSON.parse(JSON.stringify(context.__agyNativeAdapter.executionState('main')));
  assert.equal(ex.status,1);
  assert.equal(ex.turnStartStepIndex,12);
  assert.equal(ex.userTurnStartStepIndex,10);
  assert.equal(ex.isSystemTurn,true);
  assert.equal(ex.notFullyIdle,true);
  assert.deepEqual(ex.activeSubagents,[{title:'UI Verification',status:'running'}]);
});

test('master switch restores renamed native hooks and reuses saved enhancements on enable',async()=>{
  const original={checkpointConfig:{enabled:true},plannerConfig:{noToolExplanation:true}};
  const nativeResolve=()=>original,nativeSegment=()=>({body:{type:'collapsible'}}),send=payload=>payload;
  const service={forkConversation(){},sendUserCascadeMessage:send};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value:service},return:null}};
  const context=vm.createContext({document:{querySelector:()=>element},renamedResolve:nativeResolve,renamedSegment:nativeSegment,
    __agyNativeBindings:{names:{resolve:'renamedResolve',segment:'renamedSegment',menu:'renamedMenu'}},I:{},tc:(_,value)=>structuredClone(value),Wb:(_,value)=>value});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  adapter.setStageUpdates(true);adapter.setContextLimit(1000000);adapter.setEfficientIO(true);adapter.setPragmaticCoding(true);
  assert.equal(context.renamedResolve().checkpointConfig.maxTokenLimit,1000000);
  adapter.setEnabled(false);
  assert.equal(context.renamedResolve,nativeResolve);assert.equal(context.renamedSegment,nativeSegment);assert.equal(service.sendUserCascadeMessage,send);
  assert.equal(adapter.stageUpdates,false);assert.equal(context.sjc,undefined);assert.equal(context.Yyc,undefined);
  adapter.setEnabled(true);
  const config=context.renamedResolve();assert.equal(config.checkpointConfig.maxTokenLimit,1000000);
  assert.deepEqual(Array.from(config.plannerConfig.promptSectionCustomizationConfig.appendPromptSections,p=>p.title),['powertools_stage_updates','powertools_efficient_io','powertools_pragmatic_coding']);
  adapter.setPragmaticCoding(false);
  assert.deepEqual(Array.from(context.renamedResolve().plannerConfig.promptSectionCustomizationConfig.appendPromptSections,p=>p.title),['powertools_stage_updates','powertools_efficient_io']);
  adapter.setGoalBar(true);
  adapter.setConversationGoal('conv-goal',{text:'Ship all tests green',status:'active'});
  const sentWithGoal=await service.sendUserCascadeMessage({cascadeId:'conv-goal',items:[{chunk:{case:'text',value:'continue'}}]});
  assert.ok(sentWithGoal.cascadeConfig.plannerConfig.promptSectionCustomizationConfig.appendPromptSections.some(p=>p.title==='powertools_active_goal'&&p.content.includes('Ship all tests green')));
  adapter.setConversationGoal('conv-goal',null);
  adapter.dispose();assert.equal(context.renamedResolve,nativeResolve);assert.equal(context.renamedSegment,nativeSegment);
});

test('native fork inherits history via ForkConversation without sending a model prompt', async () => {
  const calls = [];
  const service = { async getCascadeTrajectory() { return { trajectory: { steps: [{metadata:{index:42},step:{case:'plannerResponse'}},{metadata:{index:43},step:{case:'systemMessage'}},{metadata:{index:44},step:{case:'userInput'}}] } }; }, async forkConversation(request) { calls.push(request); return { newCascadeId: 'new-id', newProjectId: 'project-id', forkedAtStepIndex: 183, warnings: [] }; } };
  const element = { '__reactFiber$fixture': { tag: 5, return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null } } };
  const context = vm.createContext({ document: { querySelector: () => element }, HU: metadata => metadata.index });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const result = await context.__agyNativeAdapter.fork('source-id');
  assert.equal(result.conversationId, 'new-id');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ sourceCascadeId: 'source-id', forkAtStepIndex: -1, targetForkWorkspace: 1 }]);
  await context.__agyNativeAdapter.fork('source-id', 42);
  assert.equal(calls[1].forkAtStepIndex, 43);
  assert.equal(await context.__agyNativeAdapter.forkPoint('source-id', 44), -1);
  await assert.rejects(context.__agyNativeAdapter.fork('../source', 4), /Invalid/);
  await assert.rejects(context.__agyNativeAdapter.fork('source', -2), /Invalid/);
  assert.equal(calls.length, 2);
  await context.__agyNativeAdapter.fork('source-id', 42, { exact: true });
  assert.equal(calls[2].forkAtStepIndex, 42);
});

test('fork automatically promotes via Side Question and cleans up temp trajectory when direct fork rejects subagents', async () => {
  const events = [];
  const service = {
    async getCascadeTrajectory() { return { trajectory: { steps: [{ metadata: { index: 10 }, step: { case: 'plannerResponse' } }, { metadata: { index: 11 }, step: { case: 'userInput' } }] } }; },
    async startCascade(req) { events.push({ op: 'startCascade', trajectoryType: req.trajectoryType, parent: req.baseTrajectoryIdentifier?.identifier?.value, cascadeId: req.cascadeId }); },
    async forkConversation(req) {
      events.push({ op: 'forkConversation', sourceCascadeId: req.sourceCascadeId, forkAtStepIndex: req.forkAtStepIndex });
      if (req.sourceCascadeId === 'sub-chat') throw new Error('failed to create forked conversation: forking is not supported for conversations that have invoked subagents');
      return { newCascadeId: 'promoted-id', newProjectId: 'proj-1', forkedAtStepIndex: req.forkAtStepIndex, warnings: [] };
    },
    async deleteCascadeTrajectory(id) { events.push({ op: 'delete', id }); }
  };
  const element = { '__reactFiber$fixture': { tag: 5, return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null } } };
  const context = vm.createContext({ document: { querySelector: () => element }, HU: m => m.index, crypto: { randomUUID: () => 'sq-temp-1' } });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);

  const resEnd = await context.__agyNativeAdapter.fork('sub-chat', -1);
  assert.equal(resEnd.conversationId, 'promoted-id');
  assert.equal(resEnd.promotedViaSideQuestion, true);
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    { op: 'forkConversation', sourceCascadeId: 'sub-chat', forkAtStepIndex: -1 },
    { op: 'startCascade', trajectoryType: 22, parent: 'sub-chat', cascadeId: 'sq-temp-1' },
    { op: 'forkConversation', sourceCascadeId: 'sq-temp-1', forkAtStepIndex: -1 },
    { op: 'delete', id: 'sq-temp-1' }
  ]);

  events.length = 0;
  const resHist = await context.__agyNativeAdapter.fork('sub-chat', 10, { exact: true });
  assert.equal(resHist.conversationId, 'promoted-id');
  assert.equal(events[2].forkAtStepIndex, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(events[3])), { op: 'delete', id: 'sq-temp-1' });
});

test('forked conversations automatically receive an incremented (N) title annotation', async () => {
  const annotationCalls = [];
  const summaries = {
    'source-1': { summary: '优化 README 文件指南' },
    'existing-1': { annotations: { title: '优化 README 文件指南 (1)' } }
  };
  const reduxStore = { getState: () => ({ trajectorySummaries: { summaries } }), dispatch() {} };
  const service = {
    async getCascadeTrajectory() { return { trajectory: { steps: [] } }; },
    async forkConversation() { return { newCascadeId: 'forked-2', newProjectId: 'proj-1', forkedAtStepIndex: -1, warnings: [] }; },
    async updateConversationAnnotations(ids, ann, merge) { annotationCalls.push([ids, ann, merge]); }
  };
  const element = {
    '__reactFiber$fixture': {
      tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } },
      return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
    }
  };
  const context = vm.createContext({
    document: { querySelector: () => element, querySelectorAll: () => [] },
    HU: m => m.index,
    YF: { ConversationAnnotationsSchema: 'ann-schema' },
    Wb: (schema, value) => ({ schema, ...value })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  assert.equal(adapter.nextBranchTitle('测试会话', []), '测试会话 (1)');
  assert.equal(adapter.nextBranchTitle('测试会话 (1)', ['测试会话', '测试会话 (1)']), '测试会话 (2)');

  await adapter.fork('source-1');
  assert.equal(annotationCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(annotationCalls[0])), [['forked-2'], { schema: 'ann-schema', title: '优化 README 文件指南 (2)' }, true]);
});

test('unreadCount tracks idle completed background chats and unfocused active chat while excluding subagents and archived chats', () => {
  const summaries = {
    'active-chat': { lastModifiedTime: { seconds: 200 }, annotations: { lastUserViewTime: { seconds: 150 } }, notFullyIdle: false },
    'bg-done': { lastModifiedTime: { seconds: 300 }, annotations: { lastUserViewTime: { seconds: 100 } }, notFullyIdle: false },
    'bg-running': { lastModifiedTime: { seconds: 400 }, annotations: { lastUserViewTime: { seconds: 100 } }, notFullyIdle: true },
    'subagent-1': { lastModifiedTime: { seconds: 400 }, annotations: { lastUserViewTime: { seconds: 100 } }, parentConversationId: 'active-chat', nestingDepth: 1 },
    'archived-1': { lastModifiedTime: { seconds: 400 }, annotations: { lastUserViewTime: { seconds: 100 }, archived: true } },
    'old-unviewed': { lastModifiedTime: { seconds: 400 }, annotations: {} },
    'manual-unread': { lastModifiedTime: { seconds: 50 }, annotations: { markedAsUnread: true } }
  };
  const reduxStore = { getState: () => ({ trajectorySummaries: { summaries }, conversation: { localLastViewedTimes: { 'bg-done': 120 } } }), dispatch() {} };
  const element = { '__reactFiber$fixture': { tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } }, return: null } };
  const context = vm.createContext({ document: { querySelector: () => element } });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  assert.equal(context.__agyNativeAdapter.unreadCount('active-chat', true), 2); // bg-done + manual-unread
  assert.equal(context.__agyNativeAdapter.unreadCount('active-chat', false), 3); // + active-chat when unfocused
});

test('message editing rewinds conversation only and preserves attachment and reference data', async () => {
  const calls = [];
  const scope = { chunk: { case: 'item', value: { file: 'reference.md' } } };
  const media = [{ uri: 'attachment.png' }];
  const message = { cascadeId: 'source', metadata: { index: 4 }, step: { items: [{ chunk: { case: 'text', value: 'before' } }, scope, { chunk: { case: 'text', value: 'after' } }], media, artifactComments: [{ comment: 'keep' }] } };
  const value = { stepHandler: { async revertToIndex(...args) { calls.push(['revert', ...args]); } }, async sendMessage(payload) { calls.push(['send', payload]); } };
  const context = vm.createContext({ document: { querySelector() {} }, HU: metadata => metadata.index });
  const element = { '__reactFiber$fixture': { tag: 0, memoizedProps: message, return: { tag: 10, type: {}, memoizedProps: { value }, return: null } } };
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  await context.__agyNativeAdapter.editAndResend(element, 'replacement');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['revert', 'source', 3, { conversationOnly: true }]);
  assert.equal(calls[1][1].items[0].chunk.value, 'replacement');
  assert.equal(calls[1][1].items[1], scope); assert.equal(calls[1][1].items.length, 2);
  assert.equal(calls[1][1].media, media);
  assert.equal(calls[1][1].commentOverrides.artifactComments, message.step.artifactComments);
  await assert.rejects(context.__agyNativeAdapter.editAndResend(element, '  '), /请输入/);
  assert.equal(calls.length, 2);
  value.stepHandler.revertToIndex = async () => { throw new Error('failed'); };
  await assert.rejects(context.__agyNativeAdapter.editAndResend(element, 'retry'), /failed/);
  assert.equal(calls.length, 2);
});

test('composer-driven message editing loads rich quotes and media into Lexical, supports cancel draft restore, and rewinds before native send', async () => {
  const events = [];
  let editorState = 'draft-before', attachments = [{ uri: 'draft.png' }];
  const quoteItem = { chunk: { case: 'item', value: { scopeItem: { case: 'quote', value: { text: 'quoted snippet' } } } } };
  const message = {
    cascadeId: 'conv-1',
    metadata: { index: 6 },
    step: {
      items: [{ chunk: { case: 'text', value: 'hello ' } }, quoteItem],
      media: [{ uri: 'artifact://img1.png', mimeType: 'image/png' }],
      artifactComments: [{ comment: 'note' }]
    }
  };
  const editor = {
    getEditorState: () => editorState,
    setEditorState: next => { editorState = next; events.push(['editor', next]); },
    focus: () => events.push(['focus'])
  };
  const box = {
    lexicalRef: { current: editor },
    getMediaAttachments: () => attachments,
    setMediaAttachments: next => { attachments = next; events.push(['media', next]); },
    floatingContentRef: { current: {} }
  };
  const service = {
    forkConversation() {},
    async cancelCascadeInvocation(req) { events.push(['cancelRun', req]); },
    async sendUserCascadeMessage(payload) { events.push(['rpcSend', payload]); return { ok: true }; }
  };
  const stepHandler = {
    resolveArtifactUrl: uri => `https://local.test/${encodeURIComponent(uri)}`,
    async revertToIndex(...args) { events.push(['revert', ...args]); }
  };
  const optimistic = {
    applyOptimisticRevert(id, idx) { events.push(['optRevert', id, idx]); return { dispose: () => events.push(['optDispose']) }; }
  };
  const inputBox = { parentNode: null, nextSibling: null };
  const bottomDock = {
    isConnected: true,
    children: [inputBox],
    insertBefore(node, before) {
      node.parentNode?.children?.splice?.(node.parentNode.children.indexOf(node), 1);
      const idx = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(idx < 0 ? this.children.length : idx, 0, node);
      node.parentNode = this;
      node.nextSibling = before || null;
    }
  };
  inputBox.parentNode = bottomDock;
  inputBox.parentElement = bottomDock;
  const makeNode = tag => ({
    tag, dataset: {}, className: '', textContent: '', children: [],
    append(...items) { for (const item of items) { item.parentNode?.children?.splice?.(item.parentNode.children.indexOf(item), 1); item.parentNode = this; this.children.push(item); } },
    addEventListener() {},
    remove() { if (this.parentNode?.children) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); } this.parentNode = null; }
  });
  const element = {
    attrs: new Set(), children: [],
    setAttribute(k) { this.attrs.add(k); },
    removeAttribute(k) { this.attrs.delete(k); },
    prepend(node) { node.parentNode = this; this.children.unshift(node); },
    closest: () => ({ querySelector: () => inputBox }),
    '__reactFiber$fixture': {
      tag: 0, memoizedProps: message,
      return: {
        tag: 10, type: {}, memoizedProps: { value: { stepHandler, restoreReviewComments: arg => events.push(['comments', arg.cascadeId]) } },
        return: {
          tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
          return: {
            tag: 10, type: {}, memoizedProps: { value: optimistic },
            return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
          }
        }
      }
    }
  };
  const context = vm.createContext({
    document: { querySelector: sel => sel ? null : element, createElement: makeNode },
    HU: m => m.index,
    LN: items => ({ serialized: items }),
    IJ: (_, json) => ({ parsed: json }),
    fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
    I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  await adapter.beginEdit(element);
  assert.equal(adapter.pendingEdit.stepIndex, 6);
  assert.equal(element.attrs.has('data-agy-editing-target'), true);
  assert.equal(inputBox.parentNode, adapter.pendingEdit.inlineHost);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState)), { parsed: { serialized: message.step.items } });
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].uri, '');
  assert.deepEqual(Array.from(attachments[0].payload.value), [1, 2, 3]);

  adapter.cancelEdit();
  assert.equal(adapter.pendingEdit, null);
  assert.equal(element.attrs.has('data-agy-editing-target'), false);
  assert.equal(inputBox.parentNode, bottomDock);
  assert.equal(editorState, 'draft-before');
  assert.deepEqual(JSON.parse(JSON.stringify(attachments)), [{ uri: 'draft.png' }]);

  events.length = 0;
  await adapter.beginEdit(element);
  assert.equal(inputBox.parentNode, adapter.pendingEdit.inlineHost);
  const editedItems = [{ chunk: { case: 'text', value: 'updated ' } }, quoteItem];
  const editedMedia = [...attachments, { uri: 'new-upload.png', mimeType: 'image/png' }];
  await service.sendUserCascadeMessage({ cascadeId: 'conv-1', items: editedItems, media: editedMedia, deliveryStrategy: 2 });
  assert.equal(adapter.pendingEdit, null);
  assert.equal(inputBox.parentNode, bottomDock);
  assert.equal(element.attrs.has('data-agy-editing-target'), false);
  const revertIdx = events.findIndex(e => e[0] === 'revert');
  const sendIdx = events.findIndex(e => e[0] === 'rpcSend');
  assert.ok(revertIdx >= 0 && sendIdx > revertIdx);
  assert.deepEqual(JSON.parse(JSON.stringify(events[revertIdx])), ['revert', 'conv-1', 5, { conversationOnly: true }]);
  const sent = events[sendIdx][1];
  assert.equal(sent.items, editedItems);
  assert.equal(sent.media, editedMedia);
  assert.equal(sent.deliveryStrategy, undefined);
  assert.equal(sent.artifactComments, message.step.artifactComments);
  assert.ok(events.some(e => e[0] === 'optDispose'));
});

test('suspendEdit preserves edited text and media across session switch without leaking into bottom composer', async () => {
  const makeSerialized = text => ({ text, toJSON: () => ({ root: { text } }) });
  let editorState1 = makeSerialized('normal-draft'), attachments1 = [{ uri: 'normal.png' }];
  const message = {
    cascadeId: 'conv-a',
    metadata: { index: 4 },
    step: {
      items: [{ chunk: { case: 'text', value: 'original msg' } }],
      media: [{ uri: 'artifact://orig.png', mimeType: 'image/png' }],
      artifactComments: []
    }
  };
  const makeNode = tag => ({
    tag, dataset: {}, className: '', textContent: '', children: [],
    append(...items) { for (const item of items) { item.parentNode?.children?.splice?.(item.parentNode.children.indexOf(item), 1); item.parentNode = this; this.children.push(item); } },
    addEventListener() {},
    remove() { if (this.parentNode?.children) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); } this.parentNode = null; }
  });
  const buildSessionDom = (getEd, setEd, getAtt, setAtt) => {
    const editor = { getEditorState: getEd, setEditorState: setEd, focus() {} };
    const box = { lexicalRef: { current: editor }, getMediaAttachments: getAtt, setMediaAttachments: setAtt, floatingContentRef: { current: {} } };
    const inputBox = { parentNode: null, nextSibling: null };
    const bottomDock = {
      isConnected: true, children: [inputBox],
      insertBefore(node, before) {
        node.parentNode?.children?.splice?.(node.parentNode.children.indexOf(node), 1);
        const idx = before ? this.children.indexOf(before) : this.children.length;
        this.children.splice(idx < 0 ? this.children.length : idx, 0, node);
        node.parentNode = this; node.nextSibling = before || null;
      }
    };
    inputBox.parentNode = bottomDock; inputBox.parentElement = bottomDock;
    const service = { forkConversation() {}, async cancelCascadeInvocation() {}, async sendUserCascadeMessage(p) { return p; } };
    const stepHandler = { resolveArtifactUrl: uri => `https://local.test/${encodeURIComponent(uri)}`, async revertToIndex() {} };
    const element = {
      isConnected: true, attrs: new Set(), children: [],
      setAttribute(k) { this.attrs.add(k); }, removeAttribute(k) { this.attrs.delete(k); },
      prepend(node) { node.parentNode = this; this.children.unshift(node); },
      closest: () => ({ querySelector: () => inputBox }),
      '__reactFiber$fixture': {
        tag: 0, memoizedProps: message,
        return: {
          tag: 10, type: {}, memoizedProps: { value: { stepHandler } },
          return: {
            tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
            return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
          }
        }
      }
    };
    return { element, inputBox, bottomDock };
  };

  const dom1 = buildSessionDom(() => editorState1, v => { editorState1 = v; }, () => attachments1, v => { attachments1 = v; });
  const context = vm.createContext({
    document: { querySelector: () => dom1.element, createElement: makeNode },
    HU: m => m.index,
    LN: items => JSON.stringify({ root: { items } }),
    IJ: (_, json) => ({ parsed: JSON.parse(json), toJSON: () => JSON.parse(json) }),
    fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([9, 8]).buffer }),
    I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  await adapter.beginEdit(dom1.element);
  // User edits text and adds another image while editing turn #4
  editorState1 = makeSerialized('in-progress edit');
  attachments1 = [...attachments1, { uri: 'extra-paste.png', mimeType: 'image/png' }];

  // User switches to another session -> suspendEdit restores original normal draft to bottom composer
  const suspended = adapter.suspendEdit();
  assert.ok(suspended);
  assert.equal(adapter.pendingEdit, null);
  assert.equal(dom1.inputBox.parentNode, dom1.bottomDock);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState1.parsed)), { root: { text: 'normal-draft' } });
  assert.deepEqual(JSON.parse(JSON.stringify(attachments1)), [{ uri: 'normal.png' }]);
  assert.equal(adapter.getSuspendedEdit('conv-a').stepIndex, 4);

  // User switches back to conv-a with freshly mounted DOM & editor
  let editorState2 = makeSerialized('normal-draft'), attachments2 = [{ uri: 'normal.png' }];
  const dom2 = buildSessionDom(() => editorState2, v => { editorState2 = v; }, () => attachments2, v => { attachments2 = v; });
  const resumed = adapter.resumeEdit(dom2.element);
  assert.ok(resumed);
  assert.equal(adapter.getSuspendedEdit('conv-a'), null);
  assert.equal(dom2.inputBox.parentNode, adapter.pendingEdit.inlineHost);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState2.parsed)), { root: { text: 'in-progress edit' } });
  assert.equal(attachments2.length, 2);
  assert.equal(attachments2[1].uri, 'extra-paste.png');

  // Canceling after resume still restores the original pre-edit bottom draft cleanly
  adapter.cancelEdit();
  assert.equal(dom2.inputBox.parentNode, dom2.bottomDock);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState2.parsed)), { root: { text: 'normal-draft' } });
  assert.deepEqual(JSON.parse(JSON.stringify(attachments2)), [{ uri: 'normal.png' }]);
});

test('context override reaches the native config resolver and restores the default without mutating base config', () => {
  const service={forkConversation(){},sendUserCascadeMessage(payload){return payload;}};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value:service},return:null}};
  const originalConfig={plannerConfig:{planModel:1417},checkpointConfig:{enabled:true}};
  const originalResolve=()=>originalConfig;
  const context=vm.createContext({document:{querySelector:()=>element},sjc:originalResolve,I:{CascadeConfigSchema:{},CheckpointConfigSchema:{}},tc:(_,value)=>structuredClone(value),Wb:(_,value)=>value});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  context.__agyNativeAdapter.setContextLimit(256000);assert.equal(context.sjc({}).checkpointConfig.maxTokenLimit,256000);
  context.__agyNativeAdapter.setContextLimit(500000);
  const resolved=context.sjc({});
  assert.equal(resolved.checkpointConfig.maxTokenLimit,500000);assert.equal(resolved.checkpointConfig.tokenThreshold,500000);
  assert.equal(resolved.checkpointConfig.enabled,true);assert.equal(originalConfig.checkpointConfig.maxTokenLimit,undefined);
  context.__agyNativeAdapter.setContextLimit(1000000);assert.equal(context.sjc({}).checkpointConfig.maxTokenLimit,1000000);
  context.__agyNativeAdapter.setContextLimit(0);assert.equal(context.sjc,originalResolve);
  assert.throws(()=>context.__agyNativeAdapter.setContextLimit(42),/上下文/);
});

test('stage updates compose with context limits, show live updates and fold them before the final answer',()=>{
  const service={forkConversation(){},sendUserCascadeMessage(payload){return payload;}};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value:service},return:null}};
  const base={plannerConfig:{noToolExplanation:true,promptSectionCustomizationConfig:{appendPromptSections:[{title:'existing',content:'preserve'}]}},checkpointConfig:{enabled:true}};
  const resolve=()=>base;
  const modelText={type:'step',step:{step:{case:'plannerResponse',value:{response:'Reading the next file.'}}}};
  const final={type:'lastTextResponse',step:{step:{case:'plannerResponse',value:{response:'Final answer'}}}};
  const render=arg=>({leadingSteps:arg.leadingSteps||[],tailSteps:[final],body:{type:'collapsible',isActive:arg.running,content:{groups:arg.groups}}});
  const context=vm.createContext({document:{querySelector:()=>element},sjc:resolve,Yyc:render,I:{},tc:(_,value)=>structuredClone(value),Wb:(_,value)=>value});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  adapter.setStageUpdates(true);adapter.setContextLimit(1000000);
  const patchedResolve=context.sjc;
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  assert.equal(context.__agyNativeAdapter,adapter);
  assert.equal(context.sjc,patchedResolve);
  const config=context.sjc({});
  assert.equal(config.plannerConfig.noToolExplanation,false);
  assert.equal(config.checkpointConfig.maxTokenLimit,1000000);
  assert.deepEqual(Array.from(config.plannerConfig.promptSectionCustomizationConfig.appendPromptSections,p=>p.title),['existing','powertools_stage_updates']);
  assert.equal(base.plannerConfig.noToolExplanation,true);
  assert.equal(base.plannerConfig.promptSectionCustomizationConfig.appendPromptSections.length,1);
  const content=context.Yyc({groups:[modelText],running:true}).body;
  assert.equal(content.type,'inline');assert.equal(content.content.groups[0],modelText);
  const complete=context.Yyc({groups:[modelText],leadingSteps:[modelText],running:false});
  assert.equal(complete.body.type,'collapsible');assert.equal(complete.body.defaultExpanded,false);
  assert.equal(complete.leadingSteps.length,0);assert.equal(complete.body.content.groups.length,2);
  assert.equal(complete.tailSteps[0],final);assert.ok(!complete.body.content.groups.includes(final));
  const thinking={type:'thinkingIndicator',thinking:'not user-facing'};
  assert.equal(context.Yyc({groups:[thinking]}).body.type,'collapsible');
  adapter.setEfficientIO(true);
  let prompts=context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.deepEqual(Array.from(prompts,p=>p.title),['existing','powertools_stage_updates','powertools_efficient_io']);
  assert.match(prompts.at(-1).content,/prefer rg/);
  assert.match(prompts.at(-1).content,/operating system/);
  adapter.setStageUpdates(false);
  assert.equal(context.Yyc,render);
  assert.equal(context.sjc({}).checkpointConfig.maxTokenLimit,1000000);
  assert.equal(context.sjc({}).plannerConfig.noToolExplanation,true);
  prompts=context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.deepEqual(Array.from(prompts,p=>p.title),['existing','powertools_efficient_io']);
  adapter.setContextLimit(0);assert.notEqual(context.sjc,resolve);
  adapter.setEfficientIO(false);assert.equal(context.sjc,resolve);
  adapter.dispose();assert.equal(context.Yyc,render);
  assert.equal(adapter.active,false);
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  assert.notEqual(context.__agyNativeAdapter,adapter);
  assert.equal(context.__agyNativeAdapter.active,true);
});

test('setSidebarProjectLimit controls per-project visible rows, supports show-all, and restores cleanly',()=>{
  const nativeFlat=args=>{
    const out=[];
    for(const g of args.groups){
      out.push({type:'header',id:`header-${g.id}`,label:g.label});
      const collapsed=args.onlyShowFirstFewConvos?.[g.id]??true;
      const slice=collapsed?g.items.slice(0,6):g.items;
      for(const it of slice)out.push({type:'row',id:it.cascadeId,cascadeId:it.cascadeId,isIndented:true,groupId:g.id});
      if(g.items.length>6)out.push({type:'show-more',id:`show-more-${g.id}`,label:collapsed?`See all (${g.items.length})`:'See less',groupId:g.id,isIndented:true});
    }
    return out;
  };
  const context=vm.createContext({
    document:{querySelector:()=>null},
    __agyNativeBindings:{names:{resolve:'sjc',segment:'Yyc',menu:'lHc',sidebarItems:'VWc'}},
    VWc:nativeFlat
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  const groups=[{id:'p1',label:'Proj1',items:Array.from({length:8},(_,i)=>({cascadeId:`c${i}`}))}];
  const call=flags=>context.VWc({groups,groupBy:'project',onlyShowFirstFewConvos:flags});

  adapter.setSidebarProjectLimit(2);
  let items=call({});
  assert.equal(items.filter(x=>x.type==='row').length,2);
  assert.equal(items.at(-1).type,'show-more');assert.equal(items.at(-1).label,'See all (8)');

  items=call({p1:false});
  assert.equal(items.filter(x=>x.type==='row').length,8);
  assert.equal(items.at(-1).label,'See less');

  adapter.setSidebarProjectLimit(-1);
  items=call({});
  assert.equal(items.filter(x=>x.type==='row').length,8);
  assert.equal(items.some(x=>x.type==='show-more'),false);

  adapter.setSidebarProjectLimit(0);
  assert.equal(context.VWc,nativeFlat);
  adapter.setSidebarProjectLimit(3);
  adapter.dispose();
  assert.equal(context.VWc,nativeFlat);
});

test('composerCascadeId resolves nearest conversationId or effectiveCascadeId for side-question and split-pane composers',()=>{
  const context=vm.createContext({document:{querySelector:()=>null}});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  const sideQuestionEl={
    '__reactFiber$sq':{
      memoizedProps:{},
      return:{
        memoizedProps:{conversationId:'sq-123',parentCascadeId:'main-1',isSideQuestion:true},
        return:{memoizedProps:{cascadeId:'main-1'},return:null}
      }
    }
  };
  const effectiveEl={
    '__reactFiber$eff':{
      memoizedProps:{effectiveCascadeId:'sq-456',parentCascadeId:'main-1'},
      return:{memoizedProps:{cascadeId:'main-1'},return:null}
    }
  };
  assert.equal(adapter.composerCascadeId(sideQuestionEl),'sq-123');
  assert.equal(adapter.composerCascadeId(effectiveEl),'sq-456');
});

test('fileTreeEntry extracts file and folder URIs and attachFileToComposer routes media via attachFiles and files/dirs via native mention helpers', async () => {
  const attached = [];
  const fileMentions = [];
  const scopeMentions = [];
  let focused = 0;
  const editor = { focus() { focused++; } };
  const box = {
    lexicalRef: { current: editor },
    async attachFiles(files) { attached.push(...files); },
    getInputCardElement: () => ({ scrollIntoView() {} })
  };
  const inputBoxEl = {
    '__reactFiber$ib': {
      tag: 10,
      memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
      return: null
    }
  };
  const treeRowEl = {
    '__reactFiber$row': {
      memoizedProps: {},
      return: {
        memoizedProps: { entry: { uri: 'file:///workspace/assets/logo.png', fileType: 1 } },
        return: null
      }
    }
  };
  const dirRowEl = {
    '__reactFiber$dir': {
      memoizedProps: { entry: { uri: 'file:///workspace/docs', fileType: 2 } },
      return: null
    }
  };
  const context = vm.createContext({
    atob,
    Uint8Array,
    File,
    document: {
      activeElement: null,
      querySelector: sel => sel.includes('agent-input-box') ? inputBoxEl : null
    },
    MUa: (ed, uri) => fileMentions.push({ ed, uri }),
    Shd: (kind, uri) => ({ kind, uri }),
    Gy: (ed, item) => scopeMentions.push({ ed, item })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  const childInFileRow = { closest: sel => sel === '[role="treeitem"]' ? treeRowEl : null };
  const childInDirRow = { closest: sel => sel === '[role="treeitem"]' ? dirRowEl : null };
  assert.deepEqual({ ...adapter.fileTreeEntry(childInFileRow) }, { uri: 'file:///workspace/assets/logo.png', isDirectory: false });
  assert.deepEqual({ ...adapter.fileTreeEntry(childInDirRow) }, { uri: 'file:///workspace/docs', isDirectory: true });

  const mediaRes = await adapter.attachFileToComposer({
    mode: 'media',
    name: 'logo.png',
    mimeType: 'image/png',
    base64: Buffer.from('PNGDATA').toString('base64')
  });
  assert.equal(mediaRes.mode, 'media');
  assert.equal(attached.length, 1);
  assert.equal(attached[0].name, 'logo.png');
  assert.equal(attached[0].type, 'image/png');
  assert.equal(attached[0].size, 7);

  const fileRes = await adapter.attachFileToComposer({
    mode: 'mention',
    kind: 'file',
    uri: 'file:///workspace/src/app.js',
    name: 'app.js'
  });
  assert.equal(fileRes.mode, 'mention');
  assert.deepEqual(fileMentions, [{ ed: editor, uri: 'file:///workspace/src/app.js' }]);

  const dirRes = await adapter.attachFileToComposer({
    mode: 'mention',
    kind: 'directory',
    isDirectory: true,
    uri: 'file:///workspace/docs',
    name: 'docs'
  });
  assert.equal(dirRes.kind, 'directory');
  assert.deepEqual(scopeMentions, [{ ed: editor, item: { kind: 'directory', uri: 'file:///workspace/docs' } }]);
  assert.equal(focused, 3);
});

test('stable sendUserCascadeMessage wrapper preserves edit revert even when composer destructured send while config overrides were off', async () => {
  const events = [];
  const editor = { getEditorState: () => ({ toJSON: () => ({ root: {} }) }), setEditorState() {}, focus() {} };
  const box = { lexicalRef: { current: editor }, getMediaAttachments: () => [], setMediaAttachments() {}, floatingContentRef: { current: {} } };
  const inputBox = { parentNode: null, nextSibling: null };
  const bottomDock = { isConnected: true, children: [inputBox], insertBefore() {} };
  inputBox.parentNode = bottomDock; inputBox.parentElement = bottomDock;
  const service = {
    forkConversation() {},
    async cancelCascadeInvocation() {},
    async sendUserCascadeMessage(payload) { events.push(['send', payload.cascadeId]); return payload; }
  };
  const stepHandler = {
    async revertToIndex(id, idx, opts) { events.push(['revert', id, idx, opts]); }
  };
  const message = { cascadeId: 'conv-stable', metadata: { index: 4 }, step: { items: [{ chunk: { case: 'text', value: 'old' } }], media: [], artifactComments: [], fileDiffComments: [], fileComments: [] } };
  const element = {
    isConnected: true, attrs: new Set(), children: [],
    setAttribute() {}, removeAttribute() {}, prepend() {},
    closest: () => ({ querySelector: () => inputBox }),
    '__reactFiber$fixture': {
      tag: 0, memoizedProps: message,
      return: {
        tag: 10, type: {}, memoizedProps: { value: { stepHandler } },
        return: {
          tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
          return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
        }
      }
    }
  };
  const makeNode = () => ({ dataset: {}, className: '', textContent: '', append() {}, addEventListener() {}, remove() {} });
  const context = vm.createContext({
    document: { querySelector: () => element, createElement: makeNode },
    HU: m => m.index,
    LN: items => JSON.stringify({ root: { items } }),
    IJ: (_, json) => JSON.parse(json),
    I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  // All config overrides OFF when conversation mounts and destructures sendUserCascadeMessage (just like native useMemo)
  adapter.setStageUpdates(false);
  adapter.setEfficientIO(false);
  adapter.setContextLimit(0);
  adapter.ensureRequestHook();
  const capturedSend = service.sendUserCascadeMessage;

  // Later user clicks Edit -> composer calls the previously captured send closure
  await adapter.beginEdit(element);
  await capturedSend({ cascadeId: 'conv-stable', items: [{ chunk: { case: 'text', value: 'edited' } }], media: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    ['revert', 'conv-stable', 3, { conversationOnly: true }],
    ['send', 'conv-stable']
  ]);
});

test('conversationDirectory and workspaceUri classify running, unread, projects, and exclude subagents', () => {
  const summaries = {
    'run-new': {
      status: 2,
      notFullyIdle: true,
      summary: 'Training baseline',
      lastModifiedTime: { seconds: 500 },
      trajectoryMetadata: {
        projectId: 'proj-a',
        workspaces: [{ workspaceFolderAbsoluteUri: 'file:///Users/dev/FlowIE' }]
      }
    },
    'run-old': {
      status: 2,
      summary: 'Fix auth scan',
      lastModifiedTime: { seconds: 300 },
      trajectoryMetadata: {
        projectId: 'proj-b',
        workspaces: [{ workspaceFolderAbsoluteUri: 'file:///Users/dev/somebug' }]
      }
    },
    'unread-1': {
      status: 1,
      summary: 'Completed check',
      lastModifiedTime: { seconds: 400 },
      annotations: { lastUserViewTime: { seconds: 200 } },
      trajectoryMetadata: {
        projectId: 'proj-a',
        workspaces: [{ workspaceFolderAbsoluteUri: 'file:///Users/dev/FlowIE' }]
      }
    },
    'sub-child': {
      status: 2,
      parentConversationId: 'run-new',
      lastModifiedTime: { seconds: 600 }
    }
  };
  const reduxStore = { getState: () => ({ trajectorySummaries: { summaries }, conversation: { localLastViewedTimes: {} } }), dispatch() {} };
  const element = { '__reactFiber$f': { tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } }, return: null } };
  const context = vm.createContext({ document: { querySelector: () => element } });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  assert.equal(adapter.workspaceUri('run-new'), 'file:///Users/dev/FlowIE');
  const dir = JSON.parse(JSON.stringify(adapter.conversationDirectory('other', true)));
  assert.deepEqual(dir.running.map(r => r.id), ['run-new', 'run-old']);
  assert.equal(dir.running[0].projectName, 'FlowIE');
  assert.deepEqual(dir.unread.map(u => u.id), ['unread-1']);
  assert.deepEqual(dir.subagentIds, ['sub-child']);
  assert.equal(dir.projects.length, 2);
});

test('openSideChat clears main composer, opens right-hand Side Question tab, hooks native slash menu, and ignores main isNested wrapper', async () => {
  const dispatched = [];
  let mainState = null, sideState = null, sideFocused = false, sideSubmitted = false, removedMention = false;
  const mainRoot = { textContent: '/侧边聊天' };
  const sideRoot = { textContent: '', focus() { sideFocused = true; } };
  const mainEditor = { _rootElement: mainRoot, setEditorState: st => { mainState = st; mainRoot.textContent = st.text; }, focus() {} };
  const sideEditor = { _rootElement: sideRoot, setEditorState: st => { sideState = st; sideRoot.textContent = st.text; }, focus() { sideFocused = true; } };
  const mainBox = { lexicalRef: { current: mainEditor } };
  const sideBox = { lexicalRef: { current: sideEditor }, submit() { sideSubmitted = true; } };
  const reduxStore = {
    getState: () => ({
      trajectorySummaries: { summaries: { 'conv-live': { stepCount: 4 }, 'conv-empty': { stepCount: 0 } } },
      sidePanelV2: { conversationPanes: {} }
    }),
    dispatch: action => dispatched.push(action)
  };
  // Regression guard: main composer lies outside conversation-view AND has an inner provider with isNested: true
  const mainCard = {
    contains: el => el === mainCard,
    closest: sel => sel === '.surface-composer-card' ? mainCard : null,
    querySelector: () => mainRoot,
    '__reactFiber$main': {
      tag: 0,
      memoizedProps: { conversationId: 'conv-live' },
      return: {
        tag: 10, type: {}, memoizedProps: { value: { isNested: true, isSubagent: false } },
        return: {
          tag: 10, type: {}, memoizedProps: { value: { isNested: false, inputBoxRef: { current: mainBox }, getLexicalEditor: () => mainEditor } },
          return: { tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } }, return: null }
        }
      }
    }
  };
  const sideCard = {
    offsetParent: {},
    contains: el => el === sideCard,
    closest: () => null,
    querySelector: () => sideRoot,
    '__reactFiber$side': {
      tag: 0,
      memoizedProps: {},
      return: {
        tag: 10, type: {}, memoizedProps: { value: { draftSideQuestionParentId: 'conv-live', isNested: true, inputBoxRef: { current: sideBox }, getLexicalEditor: () => sideEditor } },
        return: null
      }
    }
  };
  const context = vm.createContext({
    __agyNativeBindings: {
      names: { slashOptions: 'aIb', slashFilter: 'BT', slashMention: 'Cy', slashAfterInsert: 'IUa' }
    },
    aIb: specs => specs.map(sp => ({
      customLabel: sp.name,
      customDescription: sp.description,
      item: { scopeItem: { case: 'recipe', value: { recipeId: sp.path, title: sp.name, description: sp.description } } }
    })),
    BT: (opts, q) => opts.filter(o => !q || o.customLabel?.includes(q) || o.customDescription?.toLowerCase().includes(q.toLowerCase())),
    Cy: (trigger, text, payload) => ({ trigger, text, payload, remove() { removedMention = true; } }),
    IUa: () => {},
    document: {
      activeElement: mainCard,
      querySelector: sel => sel?.includes('user-input-step') ? null : mainCard,
      querySelectorAll: () => [mainCard, sideCard]
    },
    IJ: (_, rawJson) => {
      const parsed = JSON.parse(rawJson);
      const txt = parsed?.root?.children?.[0]?.children?.[0]?.text || '';
      return { text: txt };
    },
    setTimeout
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  assert.equal(adapter.getComposerText(mainCard), '/侧边聊天');
  assert.equal(adapter.isNestedComposer(mainCard), false);
  assert.equal(adapter.isNestedComposer(sideCard), true);

  // Native `/` slash menu filter injects 侧边聊天 when native btw is present, and NOT into @ file menus
  const btwOpt = { customLabel: 'btw', customDescription: 'Ask a quick question', item: { scopeItem: { case: 'recipe', value: { recipeId: 'btw' } } } };
  const matchedSlash = context.BT([btwOpt], '侧', {}, false);
  assert.equal(matchedSlash.length, 1);
  assert.equal(matchedSlash[0].customLabel, '侧边聊天');

  const fileOpt = { customLabel: 'index.ts', customDescription: '', item: { scopeItem: { case: 'file', value: { absoluteUri: 'file:///a' } } } };
  assert.equal(context.BT([fileOpt], '', {}, false).length, 1);

  // Selecting 侧边聊天 in native `/` menu removes only the /侧... mention node and opens Side Chat without wiping prior main text
  mainRoot.textContent = '先保留这段草稿 ';
  const mentionNode = context.Cy('/', '侧边聊天', { data: '{"recipe":{"recipeId":"__agy_side_chat__"}}' });
  context.IUa(mentionNode);
  assert.equal(removedMention, true);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(mainRoot.textContent, '先保留这段草稿 ');
  assert.equal(sideFocused, true);
  assert.deepEqual(
    dispatched.map(a => a.type),
    [
      'inputDrafts/clearInputDraft',
      'modelSelection/conversationCleared',
      'sidePanelV2/setContent',
      'sidePanelV2/setActiveTab',
      'sidePanel/setSidePanelOpen'
    ]
  );

  // Rejects empty unsent conversation
  const emptyRes = adapter.openSideChat('conv-empty', { sourceEl: mainCard });
  assert.equal(emptyRes.ok, false);
  assert.equal(emptyRes.reason, 'empty_conversation');

  // Inline question prefills and submits in side composer
  const qRes = adapter.openSideChat('conv-live', { sourceEl: mainCard, question: '这个函数在哪定义的？', submit: true });
  assert.equal(qRes.ok, true);
  assert.equal(mainState.text, '');
  assert.equal(sideState.text, '这个函数在哪定义的？');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(sideSubmitted, true);
});
