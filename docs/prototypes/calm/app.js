/* Standalone interaction prototype. No audio, catalog API or account requests. */
'use strict';
const $ = (selector) => document.querySelector(selector);
const icons = {
  play:'<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4Z"/>',
  heart:'<path d="M20.5 5.8c-2.3-3.3-6.3-2-8.5.7C9.8 3.8 5.8 2.5 3.5 5.8 0 11 8 17 12 20c4-3 12-9 8.5-14.2Z"/>',
  home:'<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  lira:'<path d="M5 9v6M10 4v16M15 7v10M20 10v4"/>',
  globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  library:'<path d="M4 4h11M4 9h11M4 14h6M19 8v11"/><ellipse cx="16" cy="19" rx="3" ry="2"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  right:'<path d="m9 5 7 7-7 7"/>',
  left:'<path d="m15 5-7 7 7 7"/>',
  shuffle:'<path d="M3 6h3c5 0 7 12 12 12h3M3 18h3c2 0 3-2 4-4M14 9c1-2 2-3 4-3h3m-3-3 3 3-3 3m0 6 3 3-3 3"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  retry:'<path d="M20 8a8 8 0 1 0 .5 7M20 3v5h-5"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.right}</svg>`;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stations = [
  {id:'fip', name:'FIP', place:'Париж · Франция', tags:'Джаз, соул, эклектика', art:'city', pitch:'Немного джаза.<br>И что-то неожиданное.', song:'Teardrop', artist:'Massive Attack'},
  {id:'paradise', name:'Radio Paradise', place:'Калифорния · США', tags:'Рок, электроника, эклектика', art:'vinyl', pitch:'Старые любимые.<br>Будущие любимые.', song:'Dreams', artist:'Fleetwood Mac'},
  {id:'groove', name:'SomaFM Groove Salad', place:'Сан-Франциско · США', tags:'Даунтемпо, эмбиент', art:'aurora', pitch:'Можно<br>немного выдохнуть.', song:'A Walk', artist:'Tycho'},
  {id:'night', name:'Nightride FM', place:'Синтвейв-радио', tags:'Синтвейв, ретровейв', art:'road', pitch:'Город засыпает.<br>Музыка остаётся.', song:'Nightcall', artist:'Kavinsky'},
];
const storageKey = 'radioatlas-calm-v1';
let stored = {};
try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { /* Private mode or invalid local data: start clean. */ }
const station = (id) => stations.find((s) => s.id === id) || stations[0];
const themes = ['dark','light','sunset'];
const state = {
  page:'home', current:stations.some(s=>s.id===stored.current) ? stored.current : null,
  mode:stored.current ? 'restored' : 'first', unknown:false,
  saved:Array.isArray(stored.saved) ? stored.saved.filter(x=>x && stations.some(s=>s.id===x.stationId) && typeof x.title==='string' && typeof x.artist==='string' && typeof x.at==='number').slice(0,100) : [],
  favorites:Array.isArray(stored.favorites) ? stored.favorites.filter(x=>stations.some(s=>s.id===x)) : [],
  theme:themes.includes(stored.theme) ? stored.theme : 'dark',
  accent:/^#[0-9a-f]{6}$/i.test(stored.accent || '') ? stored.accent : '',
  photo:typeof stored.photo==='string' && /^data:image\/(png|jpeg|webp);base64,/.test(stored.photo) ? stored.photo : '',
  coverColors:stored.coverColors===true, candidate:'paradise', direction:'similar', sheet:null, find:null,
};
let toastTimer;
let playbackTimer;
let focusReturn;
const art = (s) => `art/${s.art}.svg`;
const current = () => station(state.current);
const trackKey = (s) => `${s.id}:${s.song}`;
const isSaved = () => state.saved.some(x=>x.key===trackKey(current()));
const canSave = () => !!state.current && !state.unknown && ['playing','paused'].includes(state.mode);
const isPlaying = () => state.mode==='playing';
function persist() {
  try { localStorage.setItem(storageKey,JSON.stringify({current:state.current,saved:state.saved,favorites:state.favorites,theme:state.theme,accent:state.accent,photo:state.photo,coverColors:state.coverColors})); }
  catch { notify('Не удалось сохранить в этом браузере',false); }
}
function applyTheme() {
  document.documentElement.dataset.theme=state.theme;
  document.documentElement.style.removeProperty('--accent');
  if(state.accent) document.documentElement.style.setProperty('--accent',state.accent);
  const app=$('#app');
  app.style.setProperty('--photo',state.photo?`url("${state.photo}")`:'none');
  app.classList.toggle('has-photo',!!state.photo);
  app.style.removeProperty('background');
  if(state.coverColors && state.current) {
    const colors={fip:'#553044',paradise:'#624230',groove:'#184f56',night:'#4d2965'};
    const c=colors[state.current];
    app.style.background=`radial-gradient(ellipse at 25% 0%,${c}${state.theme==='light'?'38':'aa'},transparent 70%),var(--bg)`;
  }
  document.querySelectorAll('[data-action="theme"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===state.theme)));
}
function setNav() {
  document.querySelectorAll('.navigation button').forEach(b=>{
    if(b.dataset.action===state.page)b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  $('.find-dot').hidden=!state.saved.length;
}
function header(title, eyebrow='') {
  return `<header class="page-header"><div>${eyebrow?`<p class="eyebrow">${eyebrow}</p>`:''}<h1>${title}</h1></div><button class="profile" data-action="profile" aria-label="Профиль и оформление"><span class="avatar">АФ</span></button></header>`;
}
function row(s) {
  const playing=state.current===s.id&&isPlaying();
  return `<button class="row" data-action="station" data-id="${s.id}" aria-label="${playing?'Открыть плеер':'Слушать'} ${escapeHTML(s.name)}"><img src="${art(s)}" alt=""><span class="row-copy"><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML(s.tags)}</small></span>${icon(playing?'lira':'play')}</button>`;
}
function renderHome() {
  const h=stations[0];
  const playing=state.current===h.id&&isPlaying();
  $('#main').innerHTML=`${header('Добрый вечер','РАДИО, КОТОРОЕ УДИВЛЯЕТ')}
    <article class="hero"><img src="${art(h)}" alt="Иллюстрация вечернего города"><div class="hero-content"><p class="eyebrow">СЕГОДНЯ ПОПРОБУЙ</p><h2>${h.pitch}</h2><p class="hero-source">${h.name} · ${h.place}</p><div class="hero-bottom"><button class="primary" data-action="station" data-id="fip">${icon(playing?'lira':'play')}<span>${playing?'Слушаешь FIP':'Включить эфир'}</span></button><button class="icon-button hero-save" data-action="favorite" data-id="fip" aria-label="Сохранить станцию FIP" aria-pressed="${state.favorites.includes('fip')}">${icon('heart')}</button></div></div></article>
    <button class="choose-button" data-action="choose"><span class="little-fan" aria-hidden="true"><img src="art/aurora.svg" alt=""><img src="art/road.svg" alt=""></span><span>Подобрать другое</span><span>${icon('right')}</span></button>
    <section class="section"><div class="section-heading"><h2>Под настроение</h2><button data-action="choose" data-value="mood">Все ${iconInlineArrow()}</button></div><div class="moods">
      <button class="mood" data-action="preview" data-id="night"><img src="art/road.svg" alt=""><strong>Ночная езда</strong><small>Синтвейв, ретровейв</small></button>
      <button class="mood" data-action="preview" data-id="groove"><img src="art/aurora.svg" alt=""><strong>Помедленнее</strong><small>Даунтемпо, эмбиент</small></button>
      <button class="mood" data-action="preview" data-id="paradise"><img src="art/vinyl.svg" alt=""><strong>Знакомое и новое</strong><small>Музыка без границ</small></button>
    </div></section>
    <section class="section"><div class="section-heading"><h2>Ещё один хороший эфир</h2></div>${row(stations[1])}${row(stations[2])}</section>
    <section class="section"><div class="section-heading"><h2>Твои находки</h2></div><button class="find-shelf" data-action="library"><span class="stack" aria-hidden="true"><img src="${state.saved[0]?art(station(state.saved[0].stationId)):'art/vinyl.svg'}" alt=""></span><span><strong>${state.saved.length?'То, что захотелось оставить':'Хорошее не потеряется'}</strong><small>${state.saved.length?'Треки и станции — в твоём собрании':'Услышишь своё — нажми закладку'}</small></span>${icon('right')}</button></section>`;
}
function iconInlineArrow(){return '<span aria-hidden="true">›</span>';}
function renderLibrary() {
  $('#main').innerHTML=`${header('Твои находки','МОЁ')}<p class="sheet-sub">Музыка, которую захотелось оставить.</p><div id="find-list">${state.saved.length?state.saved.map(f=>`<article class="row"><img src="${art(station(f.stationId))}" alt=""><button class="row-copy" data-action="find" data-key="${escapeHTML(f.key)}"><strong>${escapeHTML(f.title)}</strong><small>${escapeHTML(f.artist)} · с ${escapeHTML(station(f.stationId).name)}</small></button><span class="row-controls"><a href="${serviceURL('spotify',f)}" target="_blank" rel="noopener noreferrer" aria-label="Найти ${escapeHTML(f.title)} в Spotify">${spotifyIcon()}</a><button class="icon-button" data-action="find" data-key="${escapeHTML(f.key)}" aria-label="Действия с находкой ${escapeHTML(f.title)}">${icon('more')}</button></span></article>`).join(''):`<div class="empty">${icon('bookmark')}<h2>Твой первый «что это было?»</h2><p>Когда понравится трек в эфире,<br>сохрани его закладкой в плеере.</p><button class="primary" data-action="home">К музыке</button></div>`}</div><section class="section"><div class="section-heading"><h2>Любимые станции</h2></div>${state.favorites.length?state.favorites.map(id=>row(station(id))).join(''):'<p class="sheet-sub">Сердце сохраняет станцию, чтобы вернуться к ней позже.</p>'}</section>`;
}
function spotifyIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M6 9q6-3 12 0M7 12q5-2 10 0M8 15q4-1.5 8 0" stroke="var(--solid)"/></svg>';}
function renderSearch() {
  $('#main').innerHTML=`${header('Найти своё')}<label class="searchbox">${icon('search')}<input id="search" type="search" placeholder="Станция или звучание" aria-label="Поиск по четырём станциям макета"></label><p class="sheet-sub">Четыре станции для знакомства с макетом.</p><div id="search-results">${stations.map(row).join('')}</div>`;
  $('#search').addEventListener('input',e=>{
    const q=e.target.value.trim().toLocaleLowerCase('ru');
    const found=stations.filter(s=>`${s.name} ${s.place} ${s.tags}`.toLocaleLowerCase('ru').includes(q));
    $('#search-results').innerHTML=found.length?found.map(row).join(''):'<p class="empty" role="status">В демонстрационном наборе не найдено.</p>';
  });
}
function renderMain() {
  if(state.page==='home')renderHome();
  else if(state.page==='library')renderLibrary();
  else if(state.page==='search')renderSearch();
  else if(state.page==='lira')$('#main').innerHTML=`${header('Лира')}<div class="lira-mark">${icon('lira')}</div><h2>Когда захочется<br>чего-то особенного.</h2><p class="sheet-sub" style="margin-top:15px">Лира поможет описать, что хочется услышать, и найти неожиданный эфир.</p><div class="draft">«Хочу что-нибудь спокойное,<br>но не совсем фоновое»</div><p class="preview-only">В этом макете чат не подключён. Подбор станций можно попробовать в лотке.</p><button class="primary" style="margin-top:20px" data-action="choose">Подобрать эфир</button>`;
  else $('#main').innerHTML=`${header('Откуда звучит','ГЛОБУС')}<p class="sheet-sub">Места из демонстрационного набора. Полный интерактивный Глобус остаётся в приложении.</p>${stations.filter(s=>s.id!=='night').map(s=>`<section class="section"><p class="eyebrow">${s.place}</p>${row(s)}</section>`).join('')}`;
  setNav();
}
function renderPlayer() {
  $('#mini').hidden=!state.current;
  if(!state.current)return;
  const s=current();
  const status={restored:'Готово к эфиру',connecting:'Подключаемся…',error:'Не удалось подключиться',paused:'На паузе',playing:s.name}[state.mode];
  $('#mini-art').src=art(s);
  $('#mini-title').textContent=canSave()?`${s.artist} — ${s.song}`:s.name;
  $('#mini-source').innerHTML=`${isPlaying()?'<i class="live-dot" aria-hidden="true"></i>':''}${escapeHTML(status || s.name)}`;
  $('.mini-save').hidden=!canSave();
  $('.mini-save').innerHTML=icon('bookmark');
  $('.mini-save').setAttribute('aria-pressed',String(isSaved()));
  $('.mini-save').setAttribute('aria-label',isSaved()?'Трек сохранён. Открыть находку':'Сохранить трек');
  $('.mini-play').innerHTML=icon(isPlaying()?'pause':state.mode==='error'?'retry':'play');
  $('.mini-play').setAttribute('aria-label',isPlaying()?'Пауза':state.mode==='error'?'Повторить подключение':'Включить эфир');
  if(state.sheet==='expand') {
    const action=$('#sheet').contains(document.activeElement)?document.activeElement?.dataset.action:null;
    renderExpanded();
    if(action)$(`#sheet [data-action="${action}"]`)?.focus({preventScroll:true});
  }
}
function update() { renderMain();renderPlayer();applyTheme(); }
function navigate(page) { closeSheet();state.page=page;renderMain();$('#main').scrollTop=0;$('#main').focus({preventScroll:true}); }
function playStation(id) {
  if(state.current===id&&isPlaying()){openSheet('expand');return;}
  clearTimeout(playbackTimer);
  state.current=id;state.mode='connecting';state.unknown=false;
  closeSheet();update();persist();
  playbackTimer=setTimeout(()=>{state.mode='playing';update();},650);
}
function togglePlay() {
  if(isPlaying()||state.mode==='connecting'){
    clearTimeout(playbackTimer);state.mode='paused';update();persist();
  } else {
    const expanded=state.sheet==='expand';playStation(state.current||'fip');if(expanded)openSheet('expand');
  }
}
function notify(text,view=true) {
  clearTimeout(toastTimer);$('#toast-text').textContent=text;$('#toast button').hidden=!view;$('#toast').hidden=false;
  toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4000);
}
function saveTrack(source) {
  if(!canSave())return;
  if(isSaved()){state.find=state.saved.find(x=>x.key===trackKey(current()));openSheet('find');return;}
  const s=current();
  state.saved.unshift({key:trackKey(s),stationId:s.id,title:s.song,artist:s.artist,at:Date.now()});
  state.saved=state.saved.slice(0,100);persist();renderPlayer();setNav();
  // Saving never navigates, reorders Home or re-renders its scroll content.
  if(state.page==='library')renderLibrary();
  const shelf=$('.find-shelf');
  if(shelf){shelf.querySelector('strong').textContent='То, что захотелось оставить';shelf.querySelector('small').textContent='Треки и станции — в твоём собрании';shelf.querySelector('img').src=art(s);}
  notify('В находках');
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches && !$('#sheet').open && source){
    const from=source.getBoundingClientRect(),to=$('#library-nav').getBoundingClientRect();
    const img=document.createElement('img');img.src=art(s);img.alt='';img.className='capture-fly';img.style.left=`${from.left}px`;img.style.top=`${from.top}px`;document.body.append(img);
    img.animate([{transform:'translate(0,0) rotate(-6deg)',opacity:1},{transform:`translate(${to.left-from.left+12}px,${to.top-from.top+2}px) scale(.35) rotate(8deg)`,opacity:0}],{duration:440,easing:'cubic-bezier(.3,0,.2,1)'}).finished.finally(()=>img.remove());
  }
}
function positionSheet(){const r=$('.device').getBoundingClientRect();document.documentElement.style.setProperty('--device-left',`${r.left}px`);document.documentElement.style.setProperty('--device-bottom',`${Math.max(0,innerHeight-r.bottom)}px`);}
function openSheet(type) {
  const dialog=$('#sheet');if(!dialog.open)focusReturn=document.activeElement;
  state.sheet=type;positionSheet();renderSheet();
  if(!dialog.open){dialog.showModal();$('#main').style.overflow='hidden';}
  else $('.sheet-header [data-action="close"]').focus({preventScroll:true});
}
function closeSheet(){if($('#sheet').open)$('#sheet').close();}
$('#sheet').addEventListener('close',()=>{state.sheet=null;$('#main').style.overflow='';if(focusReturn?.isConnected)focusReturn.focus({preventScroll:true});});
if(!('closedBy' in HTMLDialogElement.prototype))$('#sheet').addEventListener('click',e=>{if(e.target!==$('#sheet'))return;const r=$('#sheet').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeSheet();});
window.addEventListener('resize',positionSheet);
function sheet(title,body){$('#sheet-title').textContent=title;$('#sheet-content').innerHTML=body;}
function candidates(){const all=stations.filter(s=>s.id!==state.current);return state.direction==='surprise'?[...all].reverse():state.direction==='mood'?[...all].sort((a,b)=>a.id==='groove'?-1:b.id==='groove'?1:0):all;}
function renderChoose(){
  const all=candidates();if(!all.some(s=>s.id===state.candidate))state.candidate=all[0].id;
  const s=station(state.candidate),i=all.findIndex(x=>x.id===s.id);
  const sides=[all[(i-1+all.length)%all.length],s,all[(i+1)%all.length]];
  sheet('Что включим дальше?',`<div class="directions" role="group" aria-label="Направление подбора">${[['similar','В похожем духе'],['mood','По настроению'],['surprise','Удиви меня']].map(([v,t])=>`<button data-action="direction" data-value="${v}" aria-pressed="${state.direction===v}">${t}</button>`).join('')}</div><div class="fan">${sides.map((x,j)=>`<button data-action="candidate" data-id="${x.id}" data-position="${['left','center','right'][j]}" aria-label="Посмотреть ${escapeHTML(x.name)}" aria-pressed="${x.id===s.id}"><img src="${art(x)}" alt=""></button>`).join('')}</div><div class="fan-controls"><button class="icon-button" data-action="candidate-step" data-value="-1" aria-label="Предыдущая рекомендация">${icon('left')}</button><small>${i+1} / ${all.length}</small><button class="icon-button" data-action="candidate-step" data-value="1" aria-label="Следующая рекомендация">${icon('right')}</button></div><div class="candidate"><h3>${escapeHTML(s.name)}</h3><p>${escapeHTML(s.tags)}<br>${escapeHTML(s.place)}</p><button class="primary" data-action="switch" data-id="${s.id}">${icon('play')}Слушать ${escapeHTML(s.name)}</button></div><button class="sheet-link" data-action="lira">${icon('lira')}Описать Лире своими словами ${icon('right')}</button><p class="preview-only">Пример выбора из четырёх станций. Подбор по вкусу ещё не подключён.</p>`);
}
function renderExpanded(){
  const s=current();const label={playing:'Сейчас играет',paused:'На паузе',error:'Поток недоступен',connecting:'Подключаемся',restored:'Готово к эфиру'}[state.mode];
  sheet(label,`<img class="full-art" src="${art(s)}" alt="Обложка станции ${escapeHTML(s.name)}"><div class="full-title"><h3>${escapeHTML(canSave()?s.song:s.name)}</h3><p>${escapeHTML(canSave()?s.artist:s.tags)}</p><small>${escapeHTML(s.name)} · ${escapeHTML(s.place)}</small></div>${state.mode==='error'?'<p class="state-note">Станция осталась выбранной. Можно повторить подключение или выбрать другую.</p>':state.unknown?'<p class="state-note">Станция не передаёт название трека. Можно сохранить саму станцию.</p>':''}<div class="full-controls"><button class="icon-button" data-action="favorite" data-id="${s.id}" aria-label="Сохранить станцию" aria-pressed="${state.favorites.includes(s.id)}">${icon('heart')}</button><button class="icon-button play" data-action="play" aria-label="${isPlaying()?'Пауза':'Включить эфир'}">${icon(isPlaying()?'pause':state.mode==='error'?'retry':'play')}</button>${canSave()?`<button class="icon-button" data-action="save" aria-label="${isSaved()?'Открыть находку':'Сохранить трек'}" aria-pressed="${isSaved()}">${icon('bookmark')}</button>`:`<button class="icon-button" data-action="station-info" aria-label="О станции">${icon('more')}</button>`}</div><button class="choose-button" data-action="choose">${icon('shuffle')}Подобрать другое<span>${icon('right')}</span></button><button class="sheet-link" data-action="station-info">О станции и дополнительные действия</button>`);
}
function serviceURL(service,f){const query=encodeURIComponent(`${f.artist} ${f.title}`);return service==='spotify'?`https://open.spotify.com/search/${query}`:service==='apple'?`https://music.apple.com/us/search?term=${query}`:`https://music.yandex.ru/search?text=${query}`;}
function renderFind(){
  const f=state.find;if(!f){closeSheet();return;}const s=station(f.stationId);
  const date=new Date(f.at).toLocaleDateString('ru',{day:'numeric',month:'long'});
  sheet('Твоя находка',`<article class="row"><img src="${art(s)}" alt=""><span class="row-copy"><strong>${escapeHTML(f.title)}</strong><small>${escapeHTML(f.artist)}</small></span></article><p class="sheet-sub" style="margin-top:12px">Сохранено с ${escapeHTML(s.name)} · ${escapeHTML(date)}</p><div class="service-links">${[['spotify','Найти в Spotify'],['apple','Найти в Apple Music'],['yandex','Найти в Яндекс Музыке']].map(([key,label])=>`<a href="${serviceURL(key,f)}" target="_blank" rel="noopener noreferrer">${label}<span aria-hidden="true">↗</span></a>`).join('')}</div><button class="row" data-action="station" data-id="${s.id}"><span class="row-copy"><strong>На станцию ${escapeHTML(s.name)}</strong><small>Включить то, что звучит там сейчас</small></span>${icon('play')}</button><button class="row" data-action="find-lira"><span class="row-copy"><strong>Спросить Лиру об этом треке</strong><small>Подготовить вопрос</small></span>${icon('lira')}</button><button class="sheet-link destructive" data-action="remove-find">Убрать из находок</button>`);
}
function renderProfile(){sheet('Твоё пространство',`<p class="sheet-sub">Оформление этого макета. Настройки приложения и сама Theme Studio не изменяются.</p><div class="theme-swatches">${themes.map((v,i)=>`<button data-action="theme" data-value="${v}" aria-pressed="${state.theme===v}">${['Ночь','День','Закат'][i]}</button>`).join('')}</div><label class="setting">Акцент<input id="accent" type="color" value="${state.accent||({dark:'#8ee9cf',light:'#236d5c',sunset:'#ffd29b'}[state.theme])}"></label><label class="setting">Цвета из обложки<input id="cover-colors" type="checkbox" ${state.coverColors?'checked':''}></label><label class="upload" style="display:block">Своя картинка фона<input id="background-file" type="file" accept="image/png,image/jpeg,image/webp"></label>${state.photo?'<button class="sheet-link" data-action="remove-photo">Убрать картинку</button>':''}<p class="preview-only">Картинка остаётся в браузере и никуда не отправляется. В этом срезе сохраняются только оформление, находки и любимые станции.</p>`);}
function renderSheet(){
  if(state.sheet==='choose')renderChoose();else if(state.sheet==='expand')renderExpanded();else if(state.sheet==='find')renderFind();else if(state.sheet==='profile')renderProfile();
  else if(state.sheet==='station-info'){const s=current();sheet(s.name,`<p class="sheet-sub">${escapeHTML(s.tags)} · ${escapeHTML(s.place)}</p><button class="row" data-action="favorite" data-id="${s.id}"><span class="row-copy"><strong>${state.favorites.includes(s.id)?'Убрать из любимых':'Сохранить станцию'}</strong></span>${icon('heart')}</button><button class="row" data-action="choose"><span class="row-copy"><strong>Подобрать другой эфир</strong></span>${icon('shuffle')}</button><p class="preview-only">Громкость, очередь, таймер сна и остальные действия сохраняются в приложении. Их перенос — следующий срез.</p>`);}
  else if(state.sheet==='find-lira'){const f=state.find;sheet('Вопрос для Лиры',`<div class="draft">Что стоит послушать, если мне понравился ${escapeHTML(f.title)} — ${escapeHTML(f.artist)}?</div><p class="sheet-sub">Это заготовка вопроса. В прототипе Лира не подключена и не анализирует находки.</p><button class="primary" data-action="copy-question">Скопировать вопрос</button>`);}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const a=b.dataset.action;
  if(['home','search','library','lira','globe'].includes(a)){navigate(a);return;}
  if(a==='theme'){state.theme=b.dataset.value;state.accent='';applyTheme();persist();if(state.sheet==='profile')renderProfile();}
  else if(a==='profile')openSheet('profile');
  else if(a==='play')togglePlay();
  else if(a==='station'||a==='switch')playStation(b.dataset.id);
  else if(a==='expand'&&state.current)openSheet('expand');
  else if(a==='close')closeSheet();
  else if(a==='save')saveTrack(b);
  else if(a==='choose'){state.direction=b.dataset.value||'similar';state.candidate=candidates()[0].id;openSheet('choose');}
  else if(a==='preview'){state.direction='mood';state.candidate=b.dataset.id;openSheet('choose');}
  else if(a==='direction'){state.direction=b.dataset.value;state.candidate=candidates()[0].id;renderChoose();$(`[data-action="direction"][data-value="${state.direction}"]`).focus({preventScroll:true});}
  else if(a==='candidate'){state.candidate=b.dataset.id;renderChoose();$('.fan [data-position="center"]').focus({preventScroll:true});}
  else if(a==='candidate-step'){const list=candidates(),i=list.findIndex(s=>s.id===state.candidate);state.candidate=list[(i+Number(b.dataset.value)+list.length)%list.length].id;renderChoose();$(`[data-action="candidate-step"][data-value="${b.dataset.value}"]`).focus({preventScroll:true});}
  else if(a==='favorite'){const id=b.dataset.id;state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];persist();renderMain();if(state.sheet)renderSheet();}
  else if(a==='find'){state.find=state.saved.find(f=>f.key===b.dataset.key);openSheet('find');}
  else if(a==='remove-find'){state.saved=state.saved.filter(f=>f.key!==state.find.key);persist();closeSheet();renderPlayer();setNav();if(state.page==='library')renderLibrary();notify('Находка убрана',false);}
  else if(a==='station-info')openSheet('station-info');
  else if(a==='find-lira')openSheet('find-lira');
  else if(a==='copy-question'){
    if(!navigator.clipboard){b.textContent='Выдели и скопируй текст выше';return;}
    navigator.clipboard.writeText($('.draft').textContent).then(()=>{b.textContent='Скопировано';},()=>{b.textContent='Не удалось — выдели текст выше';});
  }
  else if(a==='remove-photo'){state.photo='';applyTheme();persist();renderProfile();}
  else if(a==='reset'){clearTimeout(playbackTimer);closeSheet();state.current=null;state.mode='first';state.unknown=false;state.page='home';$('#toast').hidden=true;update();persist();$('#main').scrollTop=0;}
  else if(a==='simulate'){clearTimeout(playbackTimer);closeSheet();state.current=state.current||'fip';state.unknown=b.dataset.value==='unknown';state.mode=state.unknown?'playing':b.dataset.value;state.page='home';update();}
});
document.addEventListener('change',e=>{
  if(e.target.id==='accent'){state.accent=e.target.value;applyTheme();persist();}
  if(e.target.id==='cover-colors'){state.coverColors=e.target.checked;applyTheme();persist();}
  if(e.target.id==='background-file'){
    const file=e.target.files?.[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>3*1024*1024){e.target.value='';sheet('Картинка фона','<p class="sheet-sub">Выбери PNG, JPEG или WebP до 3 МБ.</p><button class="primary" data-action="profile">Выбрать другую</button>');return;}
    const reader=new FileReader();reader.onload=()=>{state.photo=reader.result;applyTheme();persist();renderProfile();};reader.readAsDataURL(file);
  }
});
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
update();positionSheet();
