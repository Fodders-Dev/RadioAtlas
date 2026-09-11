// A3 interaction study. Previous A2 and A/B studies remain intact.
(() => {
  const originalRenderMain=renderMain, originalDock=renderDock, originalSave=save;
  // A3 keeps the A2 artwork and revises information density and map interaction.
  const rev={map:null,points:null,pointPromise:null,widgetPromise:null,mapCountry:'France',mapQuery:'',mapScope:'country',mapFocus:null,mapZoom:1.9,mapSelected:null,mapGeneration:0,
    feedItems:[],feedIndex:0,feedCleanup:null,messages:[],chatDraft:'',initial:true,chatBusy:false};
  const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const named=name=>state.stations.find(s=>s.name.includes(name));
  const refs=names=>names.map(named).filter(Boolean);
  const iconButton=(action,label,ic,attrs='')=>button(action,label,ic,'icon-button glass',attrs);
  const softCountry=c=>countryName(c);

  homeA=function(){
    return `<header class="journal-heading"><h1>Открывайте музыку</h1><div>${iconButton('nav','Поиск','search','data-tab="search"')}${iconButton('theme','Оформление','palette')}</div></header>
      <div class="welcome-line journal-welcome">${liraLine('Сегодня — чуть больше джаза.')}${button('firstplay','Включай','play','primary quick-play')}</div>
      <div class="home-feature"><button data-action="story" data-story="jazz" class="feature-link">${art('jazz')}<span class="feature-caption"><small>ИМПРОВИЗАЦИЯ / ЖИВОЙ ЗВУК</small><strong>Джаз без галстука</strong><span>Открыть подборку ${icon('arrow')}</span></span></button></div>
      <div class="home-starters">${refs(['TSF Jazz','Radio Swiss Jazz']).map(s=>row(s)).join('')}</div>
      ${sectionTitle('Под настроение','allstories','Ещё')}<div class="story-rail">${stories.slice(1).map(s=>storyCard(s)).join('')}</div>
      ${sectionTitle('Музыка на карте','worldmap','Глобус')}<div class="country-tiles">${countries.slice(0,3).map((c,i)=>`<button data-action="country" data-country="${i}" class="country-tile country-${c[3]}"><span>${c[3]}</span><strong>${c[1]}</strong><small>Исследовать ${icon('arrow')}</small></button>`).join('')}</div>
      ${sectionTitle('Независимый взгляд')}${refs(['Radio Meuh','Worldwide FM','NTS']).map(s=>row(s)).join('')}
      ${sectionTitle('Найти свой звук','genres','Все жанры')}<div class="chips">${['Jazz','Ambient','Funk','Soul','Electronic','Classical'].map(t=>button('tag',t,'','chip',`data-tag="${t.toLowerCase()}"`)).join('')}</div>${personalTeaser()}${community()}`;
  };
  renderNav=function(){
    const tabs=[['home','Главная','home'],['globe','Глобус','globe'],['feed','Лента','feed'],['lira','Лира','spark'],['library','Моё','library']];
    document.querySelector('#navigation').innerHTML=tabs.map(([id,label,ic])=>button('nav',label,ic,state.tab===id?'active':'',`data-tab="${id}" ${state.tab===id?'aria-current="page"':''}`)).join('');
  };
  renderDock=function(){originalDock();if(state.tab==='feed')return;const hint=document.querySelector('.mini-info small');if(hint)hint.textContent=state.playing?'Сейчас · открыть Ленту':'На паузе · открыть Ленту';};
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
    app.classList.add('revision-two','usability-three');app.dataset.screen=state.tab;
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

  function globeScreen(){return `<div id="real-globe" class="actual-globe"><div class="map-loading"><span></span><p>Находим эфиры на карте…</p></div></div><div class="map-vignette"></div>
    <header class="map-heading"><button class="glass map-country-switch" data-action="countries">${icon('globe')}<span>${esc(rev.world||rev.mapScope==='area'?'Страны':softCountry(rev.mapCountry))}</span>${icon('down')}</button><button class="map-world-button glass" data-action="globe-world">${icon('globe')}<span>Мир</span></button></header>
    <div class="map-legend">${icon('search')}<span>Число — группа эфиров. Нажмите, чтобы приблизить.</span></div>
    <div class="map-tools">${button('map-zoom-in','Приблизить','','icon-button glass zoom-plus')}${button('map-zoom-out','Отдалить','','icon-button glass zoom-minus')}</div>
    <button id="search-map-area" class="search-map-area glass" data-action="map-search-here" hidden>${icon('search')}<span>Искать здесь</span></button>
    <section class="explorer-panel glass" id="map-panel" data-size="${rev.panelSize||'normal'}" aria-label="Станции на карте"><div id="map-selection" aria-live="polite"></div></section>`;}
  async function widget(){if(window.RadioAtlasGlobe)return window.RadioAtlasGlobe;if(!rev.widgetPromise)rev.widgetPromise=new Promise((resolve,reject)=>{const css=document.createElement('link');css.rel='stylesheet';css.href='explorer-widget.css';document.head.append(css);const script=document.createElement('script');script.src='explorer-widget.js';script.onload=()=>resolve(window.RadioAtlasGlobe);script.onerror=()=>{rev.widgetPromise=null;reject(Error('widget'));};document.head.append(script);});return rev.widgetPromise;}
  async function points(){if(rev.points)return rev.points;if(!rev.pointPromise)rev.pointPromise=fetch('/api/catalog/points').then(r=>{if(!r.ok)throw Error('points');return r.json();}).then(d=>{rev.points=d.items.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));return rev.points;}).catch(e=>{rev.pointPromise=null;throw e;});return rev.pointPromise;}
  function countryTarget(country){const local=rev.points?.filter(p=>p.country===country)||[];if(!local.length)return window.RadioAtlasGlobe.countryCoords(country)||{lat:30,lon:10};const mid=Math.floor(local.length/2);return {lat:local.map(p=>p.lat).sort((a,b)=>a-b)[mid],lon:local.map(p=>p.lon).sort((a,b)=>a-b)[mid]};}
  const visiblePoints=()=>rev.world||rev.mapScope==='area'?rev.points:rev.points.filter(p=>p.country===rev.mapCountry);
  function pointStation(p){if(!known.has(p.id))known.set(p.id,{stationuuid:p.id,name:p.name||'Радиостанция',country:p.country,tags:'',homepage:'',geo_lat:p.lat,geo_long:p.lon});return known.get(p.id);}
  function areaPoints(){const ids=new Set(rev.areaIds||(rev.world?rev.points:rev.points.filter(p=>p.country===rev.mapCountry)).map(p=>p.id));return (rev.points||[]).filter(p=>ids.has(p.id));}
  function resultPoints(){const q=(rev.mapQuery||'').trim().toLocaleLowerCase('ru');return areaPoints().filter(p=>!q||(p.name+' '+(p.state||'')+' '+softCountry(p.country)).toLocaleLowerCase('ru').includes(q));}
  function setArea(ids,title,keepQuery=false){rev.areaIds=ids;rev.listTitle=title;rev.mapSelected=null;if(!keepQuery)rev.mapQuery='';rev.resultLimit=20;rev.map?.update({selectedId:undefined});renderMapCard();}
  function applyPanelSize(size){rev.panelSize=size;const p=document.querySelector('#map-panel');if(p)p.dataset.size=size;main.dataset.panel=size;}
  function panelHeader(title,subtitle,detail=false){return `<header class="explorer-heading">${detail?iconButton('map-results','К списку эфиров','back'):''}<div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${button(rev.panelSize==='expanded'?'map-normal':'map-expand',rev.panelSize==='expanded'?'Свернуть список':'Развернуть список','down','icon-button panel-expand')}${button(rev.panelSize==='collapsed'?'map-normal':'map-collapse',rev.panelSize==='collapsed'?'Эфиры':'Карта',rev.panelSize==='collapsed'?'feed':'globe','panel-map-toggle')}</header>`;}
  function panelRows(items){return items.slice(0,rev.resultLimit||20).map(p=>{const s=pointStation(p);return `<div class="map-result-row" data-point-id="${esc(p.id)}"><button class="map-result-name" data-action="map-row" data-id="${esc(p.id)}" aria-label="Показать ${esc(shortName(s))} на карте">${logo(s)}<span><strong>${esc(shortName(s))}</strong><small>${esc(p.state||softCountry(p.country))}</small></span></button>${button('play','Включить '+shortName(s),'play','icon-button result-play',`data-id="${esc(p.id)}"`)}</div>`;}).join('')+(items.length>(rev.resultLimit||20)?button('map-more','Ещё эфиры','down','map-load-more'):'');}
  function renderResults(){const items=resultPoints();const list=document.querySelector('#map-results');if(list){list.innerHTML=panelRows(items)||'<div class="map-empty"><p>В этой области ничего не найдено.</p>'+button('countries','Выбрать страну','globe','text-button')+'</div>';document.querySelector('#map-result-count').textContent=items.length.toLocaleString('ru')+' эфиров';}}
  function renderMapCard(){
    const el=document.querySelector('#map-selection');if(!el)return;applyPanelSize(rev.panelSize||'normal');
    if(!rev.points){el.innerHTML=panelHeader('Эфиры на карте','Загружаем станции…');return;}
    const s=rev.mapSelected;
    if(s){el.innerHTML=panelHeader('Выбрано на карте',softCountry(s.country),true)+`<div class="map-detail-body"><div class="map-detail-title">${logo(s)}<h3>${esc(shortName(s))}</h3>${button('favorite','Любимая станция','heart','icon-button '+(state.favorites.has(idOf(s))?'selected':''),`data-id="${esc(idOf(s))}" aria-pressed="${state.favorites.has(idOf(s))}"`)}</div><p>${esc(s.tags?.split(',').slice(0,5).join(' · ')||'Жанры пока не указаны источником.')}</p><div class="map-detail-actions">${button('play',state.current&&idOf(state.current)===idOf(s)&&state.playing?'Сейчас играет':'Слушать станцию','play','primary',`data-id="${esc(idOf(s))}"`)}${button('lira-about','О станции','spark','text-button',`data-id="${esc(idOf(s))}"`)}</div><p class="map-selection-note">${state.current&&idOf(state.current)!==idOf(s)?'Текущий эфир: '+esc(shortName(state.current)):'Откройте Ленту внизу для управления эфиром.'}</p></div>`;return;}
    const title=rev.listTitle||(rev.world?'Весь мир':softCountry(rev.mapCountry));
    el.innerHTML=panelHeader(title,'<count>')+`<label class="map-search-field">${icon('search')}<input id="map-query" aria-label="Поиск среди показанных станций" placeholder="Название станции или регион" value="${esc(rev.mapQuery||'')}" autocomplete="off">${button('map-clear','Сбросить поиск','close','icon-button')}</label><div class="map-list-meta"><span id="map-result-count"></span>${rev.areaIds?button('countries','Страны','globe','text-button'):''}</div><div id="map-results" class="map-results" tabindex="0" aria-label="Станции в выбранной области"></div>`;
    el.querySelector('.explorer-heading p').textContent='Название → карта · ▶ → эфир';renderResults();
  }
  async function mountGlobe(){
    const generation=rev.mapGeneration;renderMapCard();
    try{
      const [api,pts]=await Promise.all([widget(),points()]);if(state.tab!=='globe'||generation!==rev.mapGeneration)return;
      const host=document.querySelector('#real-globe');host.innerHTML='';
      const pendingId=rev.pendingMapId;rev.pendingMapId=null;const destination=pts.find(p=>p.id===pendingId);
      const target=destination||rev.mapFocus||countryTarget(rev.mapCountry),targetZoom=destination?4.7:1.7;
      const first=!rev.hasFlown;rev.hasFlown=true;
      rev.map=api.mount(host,{points:rev.mapQuery.trim()?resultPoints():visiblePoints(),focusPoint:first?{lat:25,lon:0}:target,zoomLevel:first?-.6:rev.mapZoom,selectedId:rev.mapSelected?.stationuuid,
        onPick:id=>pickPoint(id,false),onZoomChange:zoom=>{rev.mapZoom=zoom;},onCamera:camera=>{rev.mapFocus=camera.center;rev.mapZoom=camera.zoom;},
        onGroup:ids=>{setArea(ids,'Эфиры в этой группе',true);document.querySelector('#search-map-area').hidden=true;},
        onAreaChange:area=>{rev.pendingArea=area;rev.mapFocus=area.center;rev.mapScope='area';rev.map?.update({points:rev.mapQuery.trim()?rev.points.filter(p=>(p.name+' '+(p.state||'')).toLowerCase().includes(rev.mapQuery.trim().toLowerCase())):rev.points});document.querySelector('.map-country-switch span').textContent='Страны';document.querySelector('#search-map-area').hidden=false;},
        onReady:()=>{if(first&&generation===rev.mapGeneration){rev.mapFocus=target;rev.mapZoom=targetZoom;rev.map?.update({focusPoint:target,zoomLevel:targetZoom});}},
        onError:message=>toast(message)});
      renderMapCard();if(destination)pickPoint(destination.id,false);else if(pendingId)toast('У источника нет точных координат. Открыта его страна.');
    }catch(error){console.error('Explorer prototype:',error);if(state.tab!=='globe'||generation!==rev.mapGeneration)return;document.querySelector('#real-globe').innerHTML='<div class="map-loading map-error"><p>Карта временно недоступна.</p></div>';document.querySelector('#map-selection').innerHTML='<div class="map-empty"><p>Не удалось загрузить карту и станции.</p>'+button('map-retry','Повторить','arrow','primary')+'</div>';}
  }
  function jumpGlobe(country,id){
    const same=state.tab==='globe';rev.mapGeneration++;rev.mapCountry=country||rev.mapCountry;rev.mapSelected=null;rev.mapFocus=null;rev.world=false;rev.mapScope='country';rev.areaIds=null;rev.listTitle='';rev.mapQuery='';rev.panelSize='normal';
    if(modal.open)closeSheet();
    if(same&&rev.map){const point=rev.points.find(p=>p.id===id),target=point||countryTarget(rev.mapCountry);rev.mapFocus=target;rev.mapZoom=point?4.7:1.7;rev.map.update({points:visiblePoints(),focusPoint:target,zoomLevel:rev.mapZoom,selectedId:undefined});document.querySelector('.map-country-switch span').textContent=softCountry(rev.mapCountry);document.querySelector('#search-map-area').hidden=true;if(point)pickPoint(point.id,false);else renderMapCard();}
    else{rev.hasFlown=false;rev.pendingMapId=id;if(same)renderMain();else nav('globe');}
  }
  async function pickPoint(id,focus=true){
    const point=rev.points?.find(p=>p.id===id);if(!point||state.tab!=='globe')return;
    rev.mapSelected=pointStation(point);if(rev.panelSize==='collapsed')rev.panelSize='normal';
    rev.map?.update({selectedId:id,...(focus?{focusPoint:point,zoomLevel:Math.max(rev.mapZoom,4.7)}:{})});renderMapCard();
    try{const r=await fetch('/api/catalog/stations/'+encodeURIComponent(id));if(!r.ok)throw Error('station');const d=await r.json();if(d.item){known.set(id,d.item);if(rev.mapSelected?.stationuuid===id){rev.mapSelected=d.item;renderMapCard();}}}catch{if(rev.mapSelected?.stationuuid===id){const p=document.querySelector('.map-detail-body>p');if(p)p.textContent='Описание недоступно. Название и координаты — из каталога.';}}
  }
  function chatScreen(){
    return `<header class="lira-chat-heading">${lira()}<div><h1>Лира</h1><p>Ваш музыкальный проводник</p></div>${iconButton('lira-help','Что умеет Лира','more')}</header><div class="lira-demo-label">СЦЕНАРИЙ ДИАЛОГА · МАКЕТ</div><div id="chat-messages" class="chat-messages" role="log" aria-live="polite">${rev.messages.length?rev.messages.map(chatMessage).join(''):chatWelcome()}</div><div class="chat-composer-wrap"><div class="chat-prompts">${[['Удиви меня','surprise'],['Джаз без спешки','jazz'],['Куда дальше?','next']].map(([label,prompt])=>button('lira-prompt',label,'','chip',`data-prompt="${prompt}"`)).join('')}</div><form id="lira-form" class="chat-composer glass"><textarea id="lira-input" name="message" rows="1" maxlength="500" placeholder="Спросите о музыке…" aria-label="Сообщение Лире">${esc(rev.chatDraft)}</textarea><button type="submit" class="send-message" aria-label="Отправить Лире">${icon('arrow')}</button></form></div>`;
  }
  function chatWelcome(){const fip=named('FIP'),meuh=named('Radio Meuh');return `<div class="lira-opening"><h2>Что послушаем?</h2></div><div class="assistant-message"><p>Можно начать с FIP. Или добавить движения с Radio Meuh — там фанк и электроника. Какой поворот выбираем?</p>${fip?chatStation(fip,'Музыка без жанровых границ'):''}${meuh?chatStation(meuh,'Другой поворот · фанк и электроника'):''}</div>`;}
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
    const capture=['country','catalog-country','country-by-source','worldmap','feed-next','feed-prev','feed-toggle','map-zoom-in','map-zoom-out','map-retry','map-row','map-results','map-expand','map-normal','map-collapse','map-search-here','map-reset','map-clear','map-more','globe-world','lira-prompt','lira-about','lira-help','lira-search'];
    if(!capture.includes(action)&&!(action==='toggle'&&state.tab==='feed'))return;e.preventDefault();e.stopImmediatePropagation();
    if(action==='country')jumpGlobe(countries[Number(b.dataset.country)][0]);
    else if(action==='catalog-country')jumpGlobe(b.dataset.value);
    else if(action==='country-by-source')jumpGlobe(s.country,idOf(s));
    else if(action==='worldmap')jumpGlobe(rev.mapCountry);
    else if(action==='feed-next')rev.step?.(1);
    else if(action==='feed-prev')rev.step?.(-1);
    else if(action==='feed-toggle'||action==='toggle'){const changed=s&&idOf(s)!==idOf(state.current);if(s){state.current=s;rev.feedIndex=rev.feedItems.findIndex(x=>idOf(x)===idOf(s));}state.playing=changed?true:!state.playing;updateFeed();}
    else if(action==='map-zoom-in'||action==='map-zoom-out'){rev.mapZoom=Math.max(-.6,Math.min(14,rev.mapZoom+(action==='map-zoom-in'?.8:-.8)));rev.map?.update({zoomLevel:rev.mapZoom,userMove:true});}
    else if(action==='map-row')pickPoint(b.dataset.id,true);
    else if(action==='map-results'){rev.mapSelected=null;rev.map?.update({selectedId:undefined});renderMapCard();}
    else if(action==='map-expand'||action==='map-normal'||action==='map-collapse'){rev.panelSize=action==='map-expand'?'expanded':action==='map-collapse'?'collapsed':'normal';renderMapCard();}
    else if(action==='map-search-here'){const area=rev.map?.area()||rev.pendingArea;if(area){const b=area.bounds;const ids=rev.points.filter(p=>p.lat>=b.south&&p.lat<=b.north&&(b.east-b.west>=360||((p.lon-b.west+720)%360)<=b.east-b.west)).map(p=>p.id);setArea(ids,'В этой области',true);rev.map?.update({points:rev.mapQuery.trim()?resultPoints():visiblePoints()});document.querySelector('#search-map-area').hidden=true;}}
    else if(action==='map-reset')jumpGlobe(rev.mapCountry);
    else if(action==='map-clear'){rev.mapQuery='';rev.map?.update({points:visiblePoints()});renderMapCard();document.querySelector('#map-query')?.focus();}
    else if(action==='map-more'){rev.resultLimit=(rev.resultLimit||20)+20;const y=document.querySelector('#map-results').scrollTop;renderResults();document.querySelector('#map-results').scrollTop=y;}
    else if(action==='globe-world'){rev.mapGeneration++;rev.world=true;rev.mapScope='area';document.querySelector('.map-country-switch span').textContent='Страны';rev.mapZoom=-.6;rev.mapFocus={lat:25,lon:0};rev.areaIds=null;rev.mapSelected=null;rev.mapQuery='';rev.listTitle='Весь мир';rev.map?.update({points:visiblePoints(),zoomLevel:-.6,focusPoint:rev.mapFocus,selectedId:undefined});renderMapCard();}
    else if(action==='map-retry')mountGlobe();
    else if(action==='lira-prompt')promptLira(b.dataset.prompt);
    else if(action==='lira-about'){addChat('Расскажи об источнике '+shortName(s),`${shortName(s)} · ${softCountry(s.country)}.${s.tags?' В каталоге у него указаны: '+s.tags.split(',').slice(0,4).join(', ')+'.':''}\n\nМожно послушать эфир или продолжить прогулку по его стране.`,[s]);}
    else if(action==='lira-help')openSheet('Лира рядом',`<div class="lira-profile">${lira()}<h3>Музыка, места<br>и неожиданные повороты.</h3><p>Лира — ведущая и проводник: помогает выбирать радио и пользоваться приложением.</p></div><p class="footnote">Здесь можно пройти сценарии диалога и нажать действия. Живой AI в этом макете не подключён.</p>`);
    else if(action==='lira-search')browse(b.dataset.query,{q:b.dataset.query});
  },true);
  app.addEventListener('input',e=>{if(e.target.id!=='map-query')return;rev.mapQuery=e.target.value;rev.resultLimit=20;renderResults();rev.map?.update({points:rev.mapQuery.trim()?resultPoints():visiblePoints()});});
  app.addEventListener('submit',e=>{if(e.target.id!=='lira-form')return;e.preventDefault();e.stopImmediatePropagation();const field=document.querySelector('#lira-input');const text=field.value.trim();field.value='';submitLira(text);},true);
  app.addEventListener('keydown',e=>{if(e.target.id==='lira-input'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();const text=e.target.value.trim();e.target.value='';submitLira(text);}});
  window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;const view=e.data?.journalView;if(!['home','feed','globe','lira'].includes(view))return;if(modal.open)closeSheet();nav(view);});
})();
