// A2 is an isolated continuation of the Journal. The A/B studies remain intact.
(() => {
  const originalRenderMain=renderMain, originalDock=renderDock, originalSave=save;
  const originalHome=homeA;
  const rev={map:null,points:null,pointPromise:null,widgetPromise:null,mapCountry:'France',mapFocus:null,mapZoom:1.9,mapSelected:null,mapGeneration:0,
    feedItems:[],feedIndex:0,feedCleanup:null,messages:[],chatDraft:'',initial:true,chatBusy:false};
  const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const named=name=>state.stations.find(s=>s.name.includes(name));
  const refs=names=>names.map(named).filter(Boolean);
  const iconButton=(action,label,ic,attrs='')=>button(action,label,ic,'icon-button glass',attrs);
  const softCountry=c=>countryName(c);

  homeA=function(){
    let html=originalHome();
    html=html.replace(pageHeader('Открытия','РАДИО МИРА'),`<header class="journal-heading"><div><span class="eyebrow">RADIOATLAS</span><h1>Есть что открыть.</h1></div><div>${iconButton('nav','Поиск','search','data-tab="search"')}${iconButton('theme','Оформление','palette')}</div></header>`);
    html=html.replace('<span>Начните с этих эфиров</span>','<span>Два источника, с которых стоит начать</span>');
    html=html.replace('<div class="welcome-line">', '<div class="welcome-line journal-welcome">');
    html=html.replace('Пойдём за новым звуком?','Сегодня — чуть больше джаза.');
    html=html.replaceAll('Открыть эфиры','На глобусе');
    html=html.replace('Мир звучит по-разному','Откуда этот звук?');
    html=html.replace('<div class="country-tiles">','<p class="section-description">Коснитесь страны — и окажитесь среди её эфиров.</p><div class="country-tiles">');
    return html;
  };

  renderNav=function(){
    const tabs=[['home','Главная','home'],['globe','Глобус','globe'],['feed','Лента','feed'],['lira','Лира','spark'],['library','Моё','library']];
    document.querySelector('#navigation').innerHTML=tabs.map(([id,label,ic])=>button('nav',label,ic,state.tab===id?'active':'',`data-tab="${id}" ${state.tab===id?'aria-current="page"':''}`)).join('');
  };
  renderDock=function(){originalDock();if(state.tab==='feed')return;const hint=document.querySelector('.mini-info small');if(hint)hint.textContent=state.playing?'Эфир выбран · макет без звука':'На паузе · открыть Ленту';};
  nav=function(tab){
    if(tab===state.tab){if(tab==='feed')return;if(tab==='globe')return;main.scrollTop=0;return;}
    if(state.tab==='lira')rev.chatDraft=document.querySelector('#lira-input')?.value||'';
    state.scrolls[state.tab]=main.scrollTop;
    if(modal.open)closeSheet();
    state.tab=tab;renderMain();
    if(!['feed','globe','lira'].includes(tab))main.scrollTop=state.scrolls[tab]||0;
  };
  renderMain=function(reset=false){
    if(!state.stations.length){originalRenderMain(reset);return;}
    if(rev.initial){rev.initial=false;const screen=new URLSearchParams(location.search).get('screen');if(['home','feed','globe','lira'].includes(screen))state.tab=screen;}
    rev.feedCleanup?.();rev.feedCleanup=null;
    if(rev.map){rev.map.destroy();rev.map=null;}
    rev.mapGeneration++;
    app.classList.add('revision-two');app.dataset.screen=state.tab;
    if(state.tab==='feed'){
      state.generation++;main.className='vertical-feed-page';main.innerHTML=feed();main.scrollTop=0;renderNav();renderDock();bindFeed();
    }else if(state.tab==='globe'){
      state.generation++;main.className='globe-experience';main.innerHTML=globeScreen();main.scrollTop=0;renderNav();renderDock();mountGlobe();
    }else if(state.tab==='lira'){
      state.generation++;main.className='lira-experience';main.innerHTML=chatScreen();renderNav();renderDock();scrollChat();
    }else{originalRenderMain(reset);}
  };

  function feedScene(s,index){
    const kind=/SomaFM/.test(s.name)?'ambient':/Jazz|TSF/.test(s.name)?'vinyl':/Meuh|Groove/.test(s.name)?'rhythm':'liquid';
    return `<div class="immersive-art ${kind}" aria-hidden="true"><div class="scene-orb"></div><div class="scene-ribbon"></div><div class="scene-disc"><i></i></div><span class="scene-word">${kind==='ambient'?'slow.':kind==='vinyl'?'jazz.':kind==='rhythm'?'groove.':'écoute.'}</span><span class="scene-edition">${String(index+1).padStart(2,'0')} / RADIOATLAS</span></div>`;
  }
  feed=function(){
    const current=state.current||state.stations[0];
    const items=[...state.stations];if(!items.some(s=>idOf(s)===idOf(current)))items.unshift(current);
    rev.feedItems=items;rev.feedIndex=Math.max(0,items.findIndex(s=>idOf(s)===idOf(current)));
    return `<div class="feed-topbar"><span class="feed-tab-label">Лента эфиров</span>${iconButton('timer','Таймер сна','timer')}</div><div class="vertical-feed" tabindex="0" aria-label="Вертикальная лента. Свайп вверх или вниз меняет эфир.">${items.map((s,i)=>`<article class="station-slide" data-slide="${i}" aria-label="${esc(shortName(s))}" aria-current="${i===rev.feedIndex}" ${i===rev.feedIndex?'' : 'inert aria-hidden="true"'}>
      ${feedScene(s,i)}<div class="feed-shade"></div>
      <div class="vertical-rail">
        ${button('favorite','Любимая станция','heart','rail-button glass '+(state.favorites.has(idOf(s))?'selected':''),`data-id="${esc(idOf(s))}" aria-pressed="${state.favorites.has(idOf(s))}"`)}
        ${button('lira','Спросить Лиру','spark','rail-button glass')}
        ${button('source','Об источнике','more','rail-button glass',`data-id="${esc(idOf(s))}"`)}
      </div>
      <div class="vertical-story"><button class="place-link glass" data-action="country-by-source" data-id="${esc(idOf(s))}">${icon('globe')}<span>${esc(softCountry(s.country))}</span>${icon('arrow')}</button>
        <div class="station-identity"><span class="station-air-status">${state.playing&&idOf(s)===idOf(current)?'ЭФИР ВЫБРАН':'ЭФИР НА ПАУЗЕ'}</span><h1>${esc(shortName(s))}</h1><p>${esc(s.tags?.split(',').filter(t=>!['aac','mp3','public radio','radio france'].includes(t)).slice(0,3).join(' · ')||'Музыка в прямом эфире')}</p></div>
        <div class="vertical-track"><div><span>ПРИМЕР ТРЕКА</span><strong>Friday Morning</strong><small>Khruangbin</small></div>${button('save','Сохранить трек','bookmark','round glass '+(state.finds.some(f=>f.stationId===idOf(s))?'selected':''))}</div>
        <div class="vertical-transport"><button class="listen-button glass" data-action="feed-toggle" data-id="${esc(idOf(s))}" aria-label="${state.playing&&idOf(s)===idOf(current)?'Пауза':'Включить эфир'}">${icon(state.playing&&idOf(s)===idOf(current)?'pause':'play')}<span>${state.playing&&idOf(s)===idOf(current)?'Пауза':'Слушать эфир'}</span><i class="equalizer"><b></b><b></b><b></b><b></b></i></button>${iconButton('more','Управление эфиром','volume')}</div>
      </div><div class="vertical-swipe-hint">${icon('down')}<span>Вверх — следующий эфир</span></div>
    </article>`).join('')}</div><div class="feed-stepper">${iconButton('feed-prev','Предыдущий эфир','back')}${iconButton('feed-next','Следующий эфир','down')}</div>`;
  };
  function updateFeed(){
    document.querySelectorAll('.station-slide').forEach((slide,i)=>{
      const s=rev.feedItems[i],active=idOf(s)===idOf(state.current);slide.setAttribute('aria-current',active);slide.toggleAttribute('inert',!active);slide.setAttribute('aria-hidden',!active);
      slide.querySelector('.station-air-status').textContent=active&&state.playing?'ЭФИР ВЫБРАН':'ЭФИР НА ПАУЗЕ';
      const toggle=slide.querySelector('.listen-button');toggle.setAttribute('aria-label',active&&state.playing?'Пауза':'Включить эфир');toggle.innerHTML=`${icon(active&&state.playing?'pause':'play')}<span>${active&&state.playing?'Пауза':'Слушать эфир'}</span><i class="equalizer ${active&&state.playing?'moving':''}"><b></b><b></b><b></b><b></b></i>`;
    });
  }
  function bindFeed(){
    const scroller=document.querySelector('.vertical-feed');if(!scroller)return;
    timerBadge();
    scroller.scrollTop=rev.feedIndex*scroller.clientHeight;
    let intent=false,settleTimer,drag=null,dragging=false,requestedIndex=null;
    function settle(){
      if(!intent||dragging)return;
      if(requestedIndex!==null&&Math.abs(scroller.scrollTop-requestedIndex*scroller.clientHeight)>2)return;
      const index=Math.max(0,Math.min(rev.feedItems.length-1,Math.round(scroller.scrollTop/scroller.clientHeight)));
      if(index!==rev.feedIndex){rev.feedIndex=index;state.current=rev.feedItems[index];state.playing=true;updateFeed();}
      intent=false;requestedIndex=null;
    }
    const step=delta=>{
      intent=true;
      const next=Math.max(0,Math.min(rev.feedItems.length-1,rev.feedIndex+delta));
      requestedIndex=next;
      scroller.scrollTo({top:next*scroller.clientHeight,behavior:reduced()?'instant':'smooth'});
    };
    rev.step=step;
    const wheel=()=>{intent=true;requestedIndex=null;};
    const scroll=()=>{clearTimeout(settleTimer);settleTimer=setTimeout(settle,180);};
    scroller.addEventListener('wheel',wheel,{passive:true});scroller.addEventListener('scroll',scroll,{passive:true});scroller.addEventListener('scrollend',settle);
    scroller.addEventListener('pointerdown',e=>{
      if(e.target.closest('button,a,input'))return;
      intent=true;requestedIndex=null;
      if(e.pointerType==='mouse'){drag={y:e.clientY,top:scroller.scrollTop,pointer:e.pointerId};scroller.setPointerCapture(e.pointerId);}
    });
    scroller.addEventListener('pointermove',e=>{if(!drag)return;const dy=e.clientY-drag.y;if(Math.abs(dy)>8){intent=true;dragging=true;scroller.style.scrollSnapType='none';scroller.scrollTop=drag.top-dy;}});
    scroller.addEventListener('pointerup',e=>{if(!drag)return;const dy=e.clientY-drag.y;drag=null;dragging=false;scroller.style.scrollSnapType='';if(Math.abs(dy)>60)step(dy<0?1:-1);else{scroller.scrollTo({top:rev.feedIndex*scroller.clientHeight,behavior:'smooth'});intent=false;}});
    scroller.addEventListener('pointercancel',()=>{drag=null;dragging=false;scroller.style.scrollSnapType='';});
    scroller.addEventListener('keydown',e=>{if(e.target.closest('button,input'))return;if(['ArrowDown','ArrowUp','PageDown','PageUp'].includes(e.key)){e.preventDefault();step(['ArrowDown','PageDown'].includes(e.key)?1:-1);}});
    rev.feedCleanup=()=>clearTimeout(settleTimer);
  }
  play=function(s){if(!s)return;state.current=s;state.playing=true;if(state.tab==='feed'){const index=rev.feedItems.findIndex(x=>idOf(x)===idOf(s));if(index>=0){rev.feedIndex=index;document.querySelector('.vertical-feed').scrollTop=index*document.querySelector('.vertical-feed').clientHeight;updateFeed();}else renderMain();}else renderDock();if(state.tab==='globe'){rev.map?.update({activeId:idOf(s)});renderMapCard();}toast('Выбран эфир: '+shortName(s));};
  save=function(){originalSave();if(state.tab==='feed')document.querySelectorAll('.station-slide').forEach((slide,i)=>{const b=slide.querySelector('[data-action="save"]'),saved=state.finds.some(f=>f.stationId===idOf(rev.feedItems[i]));b.classList.toggle('selected',saved);b.setAttribute('aria-label',saved?'Трек сохранён':'Сохранить трек');b.setAttribute('aria-pressed',saved);});};
  function timerBadge(){const b=document.querySelector('.feed-topbar [data-action="timer"]');if(b){b.dataset.minutes=state.timer?state.timer+' м':'';b.setAttribute('aria-label',state.timer?'Таймер сна: '+state.timer+' мин':'Таймер сна');}}
  setTimer=function(n){state.timer=n;clearTimeout(timerHandle);if(n)timerHandle=setTimeout(()=>{state.playing=false;state.timer=0;if(state.tab==='feed'){updateFeed();timerBadge();}else renderDock();toast('Таймер остановил эфир');},n*60000);closeSheet();timerBadge();toast(n?'Таймер установлен: '+n+' мин':'Таймер выключен');};

  function globeScreen(){return `<div id="real-globe" class="actual-globe"><div class="map-loading"><span></span><p>Приближаемся к музыке…</p></div></div><div class="map-vignette"></div><header class="map-heading"><button class="glass map-country-switch" data-action="countries">${icon('globe')}<span>${esc(softCountry(rev.mapCountry))}</span>${icon('down')}</button>${iconButton('globe-world','Весь мир','globe')}</header><div class="map-context"><span>НАСТРОИТЬСЯ НА МЕСТО</span><h1>${esc(softCountry(rev.mapCountry))}</h1><p>Коснитесь точки, чтобы узнать её эфир.</p></div><div class="map-tools">${iconButton('map-zoom-in','Приблизить','search')}${iconButton('map-zoom-out','Отдалить','globe')}</div><div class="map-coordinates" id="map-coverage">Точки из каталога RadioAtlas</div><section class="map-selection glass" id="map-selection" aria-live="polite"><span class="eyebrow">НА КАРТЕ</span><h2>Здесь есть что услышать.</h2><p>Передвигайте глобус и выбирайте светящиеся точки. Ваш эфир продолжает играть.</p></section>`;}
  async function widget(){if(window.RadioAtlasGlobe)return window.RadioAtlasGlobe;if(!rev.widgetPromise)rev.widgetPromise=new Promise((resolve,reject)=>{const css=document.createElement('link');css.rel='stylesheet';css.href='globe-widget.css';document.head.append(css);const script=document.createElement('script');script.src='globe-widget.js';script.onload=()=>resolve(window.RadioAtlasGlobe);script.onerror=()=>{rev.widgetPromise=null;reject(Error('widget'));};document.head.append(script);});return rev.widgetPromise;}
  async function points(){if(rev.points)return rev.points;if(!rev.pointPromise)rev.pointPromise=fetch('/api/catalog/points').then(r=>{if(!r.ok)throw Error('points');return r.json();}).then(d=>{rev.points=d.items.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));return rev.points;}).catch(e=>{rev.pointPromise=null;throw e;});return rev.pointPromise;}
  function countryTarget(country){
    // Camera anchor only. Every station keeps its actual catalog coordinates.
    // The polygon centroid includes overseas territories (France lands at sea).
    const local=rev.points?.filter(p=>p.country===country)||[];
    if(!local.length)return window.RadioAtlasGlobe.countryCoords(country)||{lat:30,lon:10};
    const middle=Math.floor(local.length/2);
    return {lat:local.map(p=>p.lat).sort((a,b)=>a-b)[middle],lon:local.map(p=>p.lon).sort((a,b)=>a-b)[middle]};
  }
  const visiblePoints=()=>rev.world?rev.points:rev.points.filter(p=>p.country===rev.mapCountry);
  async function mountGlobe(){
    const generation=rev.mapGeneration;
    try{
      const [api,pts]=await Promise.all([widget(),points()]);
      if(state.tab!=='globe'||generation!==rev.mapGeneration)return;
      const host=document.querySelector('#real-globe');host.innerHTML='';
      const pendingId=rev.pendingMapId;rev.pendingMapId=null;
      const destination=pts.find(p=>p.id===pendingId);
      const target=destination||rev.mapFocus||countryTarget(rev.mapCountry);
      const targetZoom=destination?3.3:1.9;
      const first=!rev.hasFlown;
      rev.map=api.mount(host,{points:visiblePoints(),focusPoint:first?{lat:25,lon:0}:target,zoomLevel:first?0:rev.mapZoom,activeId:state.current&&state.playing?idOf(state.current):undefined,selectedId:rev.mapSelected?.stationuuid,
        onPick:id=>pickPoint(id),onZoomChange:zoom=>{rev.mapZoom=zoom;},hintText:undefined});
      document.querySelector('#map-coverage').textContent=`${pts.filter(p=>p.country===rev.mapCountry).length.toLocaleString('ru')} точек с координатами · ${softCountry(rev.mapCountry)}`;
      if(first){rev.hasFlown=true;setTimeout(()=>{if(rev.map&&state.tab==='globe'&&generation===rev.mapGeneration){rev.mapFocus=target;rev.mapZoom=targetZoom;rev.map.update({focusPoint:target,zoomLevel:targetZoom});}},850);}
      renderMapCard();
      if(destination)pickPoint(destination.id);else if(pendingId)toast('У источника нет точных координат. Открыта его страна.');
      if(rev.world){document.querySelector('.map-context h1').textContent='Весь мир';document.querySelector('#map-coverage').textContent=pts.length.toLocaleString('ru')+' точек с координатами';}
    }catch{if(state.tab!=='globe'||generation!==rev.mapGeneration)return;document.querySelector('#real-globe').innerHTML='<div class="map-loading map-error"><p>Глобус не загрузился.</p>'+button('map-retry','Повторить','arrow','primary')+'</div>';document.querySelector('#map-coverage').textContent='Проверьте локальный preview на 5184';}
  }
  function jumpGlobe(country,id){
    const same=state.tab==='globe';rev.mapGeneration++;rev.mapCountry=country||rev.mapCountry;rev.mapSelected=null;rev.mapFocus=null;rev.world=false;
    if(modal.open)closeSheet();
    if(same&&rev.map){const point=rev.points?.find(p=>p.id===id);const target=point||countryTarget(rev.mapCountry);rev.mapFocus=target;rev.mapZoom=point?3.5:1.9;rev.map.update({points:visiblePoints(),focusPoint:target,zoomLevel:rev.mapZoom,selectedId:undefined});document.querySelector('.map-country-switch span').textContent=softCountry(rev.mapCountry);document.querySelector('.map-context h1').textContent=softCountry(rev.mapCountry);document.querySelector('#map-coverage').textContent=`${rev.points.filter(p=>p.country===rev.mapCountry).length.toLocaleString('ru')} точек с координатами · ${softCountry(rev.mapCountry)}`;if(point)pickPoint(point.id);else renderMapCard();}
    else{rev.hasFlown=false;rev.pendingMapId=id;if(same)renderMain();else nav('globe');}
  }
  async function pickPoint(id,explicit=true){
    const point=rev.points?.find(p=>p.id===id);if(!point||state.tab!=='globe')return;
    const s={stationuuid:id,name:point.name||'Радиостанция',country:point.country,tags:'',homepage:'',geo_lat:point.lat,geo_long:point.lon};
    rev.mapSelected=s;known.set(id,s);rev.map?.update({selectedId:id});renderMapCard();
    try{const r=await fetch('/api/catalog/stations/'+encodeURIComponent(id));if(!r.ok)throw Error('station');const d=await r.json();if(d.item){known.set(id,d.item);if(rev.mapSelected?.stationuuid===id){rev.mapSelected=d.item;renderMapCard();}}}catch{if(rev.mapSelected?.stationuuid===id){const status=document.querySelector('#map-selection .map-station-caption');if(status)status.textContent='Описание недоступно · название и точка из каталога';}}
  }
  function renderMapCard(){
    const el=document.querySelector('#map-selection');if(!el)return;const s=rev.mapSelected;
    if(!s){el.innerHTML=`<span class="eyebrow">ВЫБИРАЕМ МЕСТО</span><h2>Найдите свой эфир.</h2><p>Точка открывает станцию. Музыка переключится только по нажатию Play.</p>${button('map-nearby','Эфиры в этой стране','arrow','text-button')}`;return;}
    el.innerHTML=`<div class="map-station-title">${logo(s)}<span><small>ВЫБРАНО НА ГЛОБУСЕ</small><h2>${esc(shortName(s))}</h2><p class="map-station-caption">${esc(softCountry(s.country))}${s.tags?' · '+esc(s.tags.split(',').slice(0,2).join(' / ')):''}</p></span>${button('favorite','Любимая станция','heart','icon-button '+(state.favorites.has(idOf(s))?'selected':''),`data-id="${esc(idOf(s))}"`)}</div><div class="map-station-actions">${button('play',state.current&&idOf(state.current)===idOf(s)&&state.playing?'Эфир выбран':'Слушать','play','primary',`data-id="${esc(idOf(s))}"`)}${button('lira-about','Спросить Лиру','spark','text-button',`data-id="${esc(idOf(s))}"`)}${iconButton('map-next','Другая точка','arrow')}</div>`;
  }
  function nearbyPoint(){const pts=rev.points?.filter(p=>p.country===rev.mapCountry)||[];if(!pts.length){toast('В этой стране пока нет точек с координатами');return;}const index=pts.findIndex(p=>p.id===rev.mapSelected?.stationuuid);const p=pts[(index+1)%pts.length];rev.mapFocus={lat:p.lat,lon:p.lon};rev.mapZoom=3.3;rev.map?.update({focusPoint:rev.mapFocus,zoomLevel:3.3});pickPoint(p.id);}

  function chatScreen(){
    return `<header class="lira-chat-heading">${lira()}<div><h1>Лира</h1><p>Ваш музыкальный проводник</p></div>${iconButton('lira-help','Что умеет Лира','more')}</header><div class="lira-demo-label">СЦЕНАРИЙ ДИАЛОГА · МАКЕТ</div><div id="chat-messages" class="chat-messages" role="log" aria-live="polite">${rev.messages.length?rev.messages.map(chatMessage).join(''):chatWelcome()}</div><div class="chat-composer-wrap"><div class="chat-prompts">${[['Удиви меня','surprise'],['Джаз без спешки','jazz'],['Куда дальше?','next']].map(([label,prompt])=>button('lira-prompt',label,'','chip',`data-prompt="${prompt}"`)).join('')}</div><form id="lira-form" class="chat-composer glass"><textarea id="lira-input" name="message" rows="1" maxlength="500" placeholder="Спросите о музыке…" aria-label="Сообщение Лире">${esc(rev.chatDraft)}</textarea><button type="submit" class="send-message" aria-label="Отправить Лире">${icon('arrow')}</button></form></div>`;
  }
  function chatWelcome(){const fip=named('FIP');return `<div class="lira-opening"><div class="lira-sound-orbit" aria-hidden="true">${lira()}<i></i><i></i><i></i></div><h2>На какой волне<br>вы сегодня?</h2><p>Пойдём за музыкой, которую<br>вы ещё не встречали.</p></div><div class="assistant-message"><div class="message-byline">${lira()}<span>Лира</span></div><p>Начнём с FIP? Или свернём с привычного маршрута — в джаз, соул, другой город.</p>${fip?chatStation(fip,'Первая остановка · Франция'):''}</div>`;}
  function chatStation(s,note='Источник для знакомства'){return `<div class="chat-station-card"><div>${logo(s)}<span><small>${esc(note)}</small><strong>${esc(shortName(s))}</strong><span>${esc(softCountry(s.country))}</span></span>${button('play','Включить '+shortName(s),'play','icon-button',`data-id="${esc(idOf(s))}"`)}</div><button class="chat-map-link" data-action="country-by-source" data-id="${esc(idOf(s))}">${icon('globe')}<span>Показать на глобусе</span>${icon('arrow')}</button></div>`;}
  function chatMessage(m){if(m.role==='user')return `<div class="user-message"><p>${esc(m.text)}</p></div>`;return `<div class="assistant-message"><div class="message-byline">${lira()}<span>Лира</span></div><p>${esc(m.text).replaceAll('\n','<br>')}</p>${(m.ids||[]).map(id=>known.get(id)).filter(Boolean).map(s=>chatStation(s)).join('')}${m.action==='timer'?button('timer','Настроить таймер сна','timer','chat-inline-action'):m.action==='search'?button('lira-search','Искать в каталоге','search','chat-inline-action',`data-query="${esc(m.query)}"`):''}</div>`;}
  function scrollChat(){requestAnimationFrame(()=>{if(state.tab!=='lira')return;const last=main.querySelector('.user-message:last-of-type')||[...main.querySelectorAll('.user-message')].at(-1);main.scrollTop=last?last.getBoundingClientRect().top-main.getBoundingClientRect().top+main.scrollTop-main.querySelector('.lira-chat-heading').offsetHeight-18:0;});}
  function addChat(text,response,stations=[],extra={}){rev.messages.push({role:'user',text},{role:'assistant',text:response,ids:stations.map(idOf),...extra});if(state.tab!=='lira')nav('lira');else{document.querySelector('#chat-messages').innerHTML=rev.messages.map(chatMessage).join('');scrollChat();}}
  function promptLira(kind){
    const catalogChoices={jazz:refs(['TSF Jazz','Radio Swiss Jazz']),surprise:refs(['Radio Meuh','Worldwide FM']),next:refs(['NTS','SomaFM Groove Salad'])};
    const copy={jazz:['Хочу джаз без спешки.','Оставим суету за дверью. Первая остановка — TSF Jazz во Франции, затем — Radio Swiss Jazz в Швейцарии.\n\nДва джазовых эфира, два разных настроения. Включи любой — я рядом, если захочется пойти дальше.'],surprise:['Удиви меня.','Добавим в день немного движения? На Radio Meuh можно искать фанк и электронику. А на Worldwide FM — свернуть к джазу.\n\nЯ бы начала с Radio Meuh. Послушаем?'],next:['Куда отправимся дальше?','Можно заглянуть на британскую NTS — там свободный формат и диджейские сеты. Или замедлиться с downtempo и ambient на SomaFM Groove Salad.\n\nЯ покажу место на глобусе; эфир выберешь ты.']};
    const [text,response]=copy[kind]||copy.surprise;addChat(text,response,catalogChoices[kind]||catalogChoices.surprise);
  }
  function submitLira(text){
    if(!text.trim())return;rev.chatDraft='';
    const q=text.toLowerCase();
    if(q.includes('джаз')||q.includes('jazz')){addChat(text,'Для джазовой прогулки я бы поставила рядом TSF Jazz и Radio Swiss Jazz. Начни с любого, а затем открой его точку на глобусе — рядом могут оказаться совсем другие источники.',refs(['TSF Jazz','Radio Swiss Jazz']));}
    else if(q.includes('таймер')||q.includes('спать'))addChat(text,'Чтобы не отвлекаться от музыки, таймер можно открыть прямо здесь. Он же всегда доступен в правом верхнем углу Ленты.',[],{action:'timer'});
    else if(q.includes('удив')||q.includes('необыч'))promptLira('surprise');
    else if(q.includes('умеешь')||q.includes('помоги'))addChat(text,'Помогу выбрать направление и источник, покажу его на глобусе и подскажу управление.\n\nСвайп вверх в Ленте переключает эфир. Сердце сохраняет станцию, закладка — услышанный трек.');
    else addChat(text,'В этом просмотре я показываю сценарии будущего диалога. Свободный ответ живой Лиры пока не подключён.\n\nНо запрос уже можно исследовать в настоящем каталоге.',[],{action:'search',query:text});
  }
  liraSheet=function(){nav('lira');};

  app.addEventListener('click',e=>{
    const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,s=known.get(b.dataset.id);
    const capture=['country','catalog-country','country-by-source','worldmap','feed-next','feed-prev','feed-toggle','map-zoom-in','map-zoom-out','map-retry','map-next','map-nearby','globe-world','lira-prompt','lira-about','lira-help','lira-search'];
    if(!capture.includes(action)&&!(action==='toggle'&&state.tab==='feed'))return;e.preventDefault();e.stopImmediatePropagation();
    if(action==='country')jumpGlobe(countries[Number(b.dataset.country)][0]);
    else if(action==='catalog-country')jumpGlobe(b.dataset.value);
    else if(action==='country-by-source')jumpGlobe(s.country,idOf(s));
    else if(action==='worldmap')jumpGlobe(rev.mapCountry);
    else if(action==='feed-next')rev.step?.(1);
    else if(action==='feed-prev')rev.step?.(-1);
    else if(action==='feed-toggle'||action==='toggle'){const changed=s&&idOf(s)!==idOf(state.current);if(s){state.current=s;rev.feedIndex=rev.feedItems.findIndex(x=>idOf(x)===idOf(s));}state.playing=changed?true:!state.playing;updateFeed();}
    else if(action==='map-zoom-in'||action==='map-zoom-out'){rev.mapZoom=Math.max(0,Math.min(8,rev.mapZoom+(action==='map-zoom-in'?.7:-.7)));rev.map?.update({zoomLevel:rev.mapZoom});}
    else if(action==='map-next'||action==='map-nearby')nearbyPoint();
    else if(action==='globe-world'){rev.world=true;rev.mapZoom=0;rev.mapFocus={lat:25,lon:0};rev.map?.update({points:visiblePoints(),zoomLevel:0,focusPoint:rev.mapFocus});document.querySelector('.map-context h1').textContent='Весь мир';document.querySelector('#map-coverage').textContent=rev.points.length.toLocaleString('ru')+' точек с координатами';}
    else if(action==='map-retry')mountGlobe();
    else if(action==='lira-prompt')promptLira(b.dataset.prompt);
    else if(action==='lira-about'){addChat('Расскажи об источнике '+shortName(s),`${shortName(s)} · ${softCountry(s.country)}.${s.tags?' В каталоге у него указаны: '+s.tags.split(',').slice(0,4).join(', ')+'.':''}\n\nМожно послушать эфир или продолжить прогулку по его стране.`,[s]);}
    else if(action==='lira-help')openSheet('Лира рядом',`<div class="lira-profile">${lira()}<h3>Музыка, места<br>и неожиданные повороты.</h3><p>Лира — ведущая и проводник: помогает выбирать радио и пользоваться приложением.</p></div><p class="footnote">Здесь можно пройти сценарии диалога и нажать действия. Живой AI в этом макете не подключён.</p>`);
    else if(action==='lira-search')browse(b.dataset.query,{q:b.dataset.query});
  },true);
  app.addEventListener('submit',e=>{if(e.target.id!=='lira-form')return;e.preventDefault();e.stopImmediatePropagation();const field=document.querySelector('#lira-input');const text=field.value.trim();field.value='';submitLira(text);},true);
  app.addEventListener('keydown',e=>{if(e.target.id==='lira-input'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();const text=e.target.value.trim();e.target.value='';submitLira(text);}});
  window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;const view=e.data?.journalView;if(!['home','feed','globe','lira'].includes(view))return;if(modal.open)closeSheet();nav(view);});
})();
