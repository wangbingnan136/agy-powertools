(() => {
  globalThis.__agyResolveNativeBindings = function (declaredNames=[]) {
    const entries=Object.entries(Object.getOwnPropertyDescriptors(globalThis)).filter(([,d])=>'value' in d).map(([name,d])=>({name,value:d.value}));
    const seen=new Set(entries.map(e=>e.name));
    for(const name of declaredNames)if(/^[A-Za-z_$][\w$]*$/.test(name)&&!seen.has(name)){
      try{entries.push({name,value:(0,eval)(name)});seen.add(name);}catch{}
    }
    const callable=value=>{try{for(let i=0;i<3&&value&&typeof value!=='function';i++){
      if(value.$$typeof===Symbol.for('react.forward_ref'))value=value.render;
      else if(value.$$typeof===Symbol.for('react.memo'))value=value.type;
      else return null;
    }return typeof value==='function'?value:null;}catch{return null;}};
    const body=value=>{const fn=callable(value);return fn?Function.prototype.toString.call(fn):'';};
    const functions=entries.filter(e=>e.name!=='__agyResolveNativeBindings').map(e=>({...e,callable:callable(e.value),source:body(e.value)})).filter(e=>e.source);
    const names={},bindings={B:globalThis.React},missing=[];
    const find=(key,test)=>{
      const matches=functions.filter(e=>test(e.source,e.value));
      const unique=[...new Map(matches.map(e=>[e.callable,e])).values()];
      if(unique.length!==1){missing.push(`${key} (${unique.map(e=>e.name).join(',')||'missing'})`);return;}
      names[key]=unique[0].name;bindings[key]=unique[0].value;
    };
    find('HC',s=>s.includes('defaultOpen:')&&s.includes('matchTriggerWidth:')&&s.includes('disableMobileSheet:'));
    find('IC',s=>s.includes('startDragTracking:')&&s.includes('popover-trigger-element')&&s.includes('asChild:'));
    find('JC',s=>s.includes('arrowNavigable:')&&s.includes('matchTriggerWidth:')&&(s.includes('scrollContainerClassName:')||s.includes('collisionAvoidance:')||s.includes('contentRef.current=')));
    find('KC',s=>s.includes('asChild:')&&s.includes('isMobile:')&&s.includes('setIsOpen:')&&!s.includes('openOnMouseDown:')&&s.length<900);
    find('GC',s=>s.includes('tooltipPlace:')&&s.includes('secondaryAction:')&&s.includes('main-row-trigger'));
    find('Uy',s=>s.includes('paddingClassName:')&&s.includes('computedAriaLabel:')&&s.includes('asChild:'));
    find('XP',s=>s.includes('onCheckedChange:')&&s.includes('aria-describedby')&&s.includes('role:"switch"'));
    find('UP',s=>/^\(\{label:/.test(s)&&s.includes('rightElement:')&&s.includes('extraContent:')&&s.includes('descriptionId:')&&!s.includes('options:'));
    find('TP',s=>s.includes('agy-card bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border')&&s.length<400);
    find('VP',s=>s.includes('headerRight:')&&s.includes('defaultCollapsed:')&&s.includes('forceExpanded:'));
    find('dq',s=>s.startsWith('({name:')&&s.includes('google-symbols')&&s.includes('Icon'));
    find('k0',s=>s.startsWith('({trigger:')&&s.includes('triggerVisible:')&&s.includes('onCollapseComplete:')&&s.includes('defaultExpanded:'));
    find('Sy',(s,v)=>v.displayName==='CompactTooltipBaseUi');
    find('kT',s=>s.includes('ownsHighlight:')&&s.includes('onHighlightExit:')&&s.includes('onSearchQueryChange:'));
    find('lT',s=>s.includes('asChild:')&&s.includes('openOnHover:')&&s.includes('closeDelay:')&&s.includes('"data-no-drag"')&&s.length<1000);
    find('mT',s=>s.includes('collisionBoundary:')&&s.includes('pad:')&&s.includes('alignOffset:')&&s.includes('keepMounted:'));
    find('nT',s=>s.includes('highlighted:')&&s.includes('selected:')&&s.includes('action:')&&s.includes('description:')&&s.includes('managedHighlight:'));
    const toasts=functions.filter(e=>e.source.includes('showNotification')&&e.source.includes('plainTextFallback:')&&e.source.includes('autoDismissMs:')&&e.source.includes('primaryActionLabel:'));
    const uniqueToasts=[...new Map(toasts.map(e=>[e.callable,e])).values()];
    if(uniqueToasts.length===1){bindings.um=uniqueToasts[0].value;names.um=uniqueToasts[0].name;}
    find('HU',s=>s.includes('sourceTrajectoryStepInfo?.stepIndex')&&s.length<150);
    find('resolve',s=>s.includes('lookupCustomModelInfo')&&s.includes('customModelInfoOverride')&&s.includes('checkpointConfig=void 0')&&s.length<900);
    find('segment',s=>s.includes('getStepRendererConfig:')&&s.includes('hasBeenCollapsed:')&&s.includes('leadingSteps:'));
    find('menu',s=>/^function\s+[\w$]+\(\w+,\{onRenameClick:/.test(s)&&s.includes('onRestoreClick:')&&s.includes('onCreateGroup:'));
    const schemas=entries.filter(e=>{try{return e.value&&typeof e.value==='object'&&Object.getOwnPropertyDescriptor(e.value,'CascadeConfigSchema')?.value;}catch{return false;}});
    if(schemas.length===1){bindings.I=schemas[0].value;names.I=schemas[0].name;}else missing.push('protobuf schemas');
    const annSchemas=entries.filter(e=>{try{return e.value&&typeof e.value==='object'&&Object.getOwnPropertyDescriptor(e.value,'ConversationAnnotationsSchema')?.value;}catch{return false;}});
    if(annSchemas.length===1){bindings.YF=annSchemas[0].value;names.YF=annSchemas[0].name;}
    const modals=functions.filter(e=>e.source.startsWith('({children:')&&e.source.includes('closeButtonPosition:')&&e.source.includes('scrollToBottomOnOpen:'));
    const uniqueModals=[...new Map(modals.map(e=>[e.callable,e])).values()];
    if(uniqueModals.length===1){bindings.Wz=uniqueModals[0].value;names.Wz=uniqueModals[0].name;}
    const sidebarBuilders=functions.filter(e=>e.source.includes('onlyShowFirstFewConvos')&&e.source.includes('show-more-')&&e.source.includes('See all ('));
    const uniqueSidebar=[...new Map(sidebarBuilders.map(e=>[e.callable,e])).values()];
    if(uniqueSidebar.length===1){bindings.sidebarItems=uniqueSidebar[0].value;names.sidebarItems=uniqueSidebar[0].name;}
    const findOptional=(key,test)=>{
      const matches=functions.filter(e=>test(e.source,e.value));
      const unique=[...new Map(matches.map(e=>[e.callable,e])).values()];
      if(unique.length===1){names[key]=unique[0].name;bindings[key]=unique[0].value;}
    };
    findOptional('MUa',s=>s.includes('ContextScopeItemSchema')&&s.includes('absoluteUri:')&&!s.includes('switch(')&&s.length<220&&/^\s*function\s+[\w$]+\(\w+,\w+\)\{[\w$]+\(\w+,/.test(s));
    findOptional('Shd',s=>s.includes('ContextScopeItemSchema')&&/scopeItem:\{case:[A-Za-z_$]/.test(s)&&s.includes('absoluteUri:')&&!s.includes('switch(')&&s.length<200);
    findOptional('Gy',s=>s.includes('.isCollapsed()')&&s.includes('.insertNodes(')&&s.includes('discrete:!0')&&s.length<300);
    const clone=bindings.resolve&&body(bindings.resolve).match(/=([\w$]+)\([\w$]+\.CascadeConfigSchema,/);
    const cloneValue=clone&&entries.find(e=>e.name===clone[1])?.value;
    if(typeof cloneValue==='function'){bindings.tc=cloneValue;names.tc=clone[1];}else missing.push('protobuf clone');
    find('Wb',s=>s.includes('.$typeName=')&&s.includes('.members')&&s.includes('oneof')&&s.includes('Object.create'));
    bindings.VD=options=>globalThis.createFileRoute('/powertools')(options);
    if(typeof globalThis.createFileRoute!=='function')missing.push('route factory');
    // Only used to restore an edited draft after a failed send.
    find('IJ',s=>s.includes('._dirtyElements')&&s.includes('._dirtyLeaves')&&s.includes('._parsed=!0')&&s.includes('JSON.parse'));
    find('LN',s=>s.includes('JSON.stringify')&&s.includes('version:1')&&(s.includes('contextScope')&&s.includes('chunk.case')||s.includes('singleParagraph')&&s.includes('type:"root"')));
    if(missing.length)throw Error('Antigravity compatibility: '+missing.join('; '));
    bindings.names={resolve:names.resolve,segment:names.segment,menu:names.menu,sidebarItems:names.sidebarItems};
    return {bindings,names};
  };
})();
