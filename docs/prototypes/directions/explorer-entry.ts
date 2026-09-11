import maplibregl, {type GeoJSONSource} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {feature} from 'topojson-client';
import world from '../../../apps/webapp/src/assets/countries-110m.json';
import {resolveCountryCoords} from '../../../apps/webapp/src/lib/geoResolver';

// Isolated interaction study using the same MapLibre globe, Natural Earth and
// Esri basemap as the app. The production Globe component is not modified.
type Point={id:string;lat:number;lon:number;name?:string;country?:string;state?:string};
const data=(points:Point[])=>({type:'FeatureCollection',features:points.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.lon,p.lat]},properties:{id:p.id,name:p.name||'',country:p.country||''}}))});
const empty={type:'FeatureCollection',features:[]};
const boundaries=feature(world as any,world.objects.countries as any);
const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

(window as any).RadioAtlasGlobe={
  countryCoords:resolveCountryCoords,
  mount(host:HTMLElement,initial:any){
    let props={...initial},ready=false,disposed=false,userMoved=false,selectionRevision=0;
    const map=new maplibregl.Map({container:host,center:[initial.focusPoint?.lon||0,initial.focusPoint?.lat||25],zoom:(initial.zoomLevel??0)+1.4,attributionControl:{compact:true},dragRotate:false,pitchWithRotate:false,clickTolerance:12,
      style:{version:8,projection:{type:'globe'},glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',sources:{
        satellite:{type:'raster',tiles:['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'<a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a> World Imagery'},
        countries:{type:'geojson',data:boundaries as any},
        stations:{type:'geojson',data:data(initial.points) as any,cluster:true,clusterRadius:38,clusterMaxZoom:13},
        selected:{type:'geojson',data:empty as any}},layers:[
        {id:'sky',type:'background',paint:{'background-color':'#eadbc3'}},
        {id:'earth',type:'raster',source:'satellite',paint:{'raster-saturation':-.45,'raster-contrast':-.12,'raster-brightness-min':.18}},
        {id:'borders',type:'line',source:'countries',paint:{'line-color':'#ffe6bb','line-opacity':.36,'line-width':.6}},
        {id:'groups-shadow',type:'circle',source:'stations',filter:['has','point_count'],paint:{'circle-radius':23,'circle-color':'#3f5c4633','circle-blur':.5}},
        {id:'groups',type:'circle',source:'stations',filter:['has','point_count'],paint:{'circle-radius':['step',['get','point_count'],17,50,20,200,23],'circle-color':'#fff1d8','circle-stroke-color':'#fffbee','circle-stroke-width':2,'circle-opacity':.95}},
        {id:'counts',type:'symbol',source:'stations',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Open Sans Semibold'],'text-size':12,'text-allow-overlap':true},paint:{'text-color':'#574631'}},
        {id:'dots',type:'circle',source:'stations',filter:['!', ['has','point_count']],paint:{'circle-radius':11,'circle-color':'#bf603b','circle-stroke-color':'#fff4dc','circle-stroke-width':2}},
        {id:'selection-halo',type:'circle',source:'selected',paint:{'circle-radius':22,'circle-color':'#ffe1a555','circle-stroke-color':'#fff2cbbb','circle-stroke-width':1}},
        {id:'selection',type:'circle',source:'selected',paint:{'circle-radius':12,'circle-color':'#a5452b','circle-stroke-color':'#fff5d9','circle-stroke-width':3}},
        {id:'selection-name',type:'symbol',source:'selected',layout:{'text-field':['get','name'],'text-font':['Open Sans Semibold'],'text-size':12,'text-anchor':'top','text-offset':[0,1.6],'text-max-width':14,'text-allow-overlap':true},paint:{'text-color':'#fff7e4','text-halo-color':'#324439','text-halo-width':2}}
      ]}});
    function syncSelection(){const point=props.points.find((p:Point)=>p.id===props.selectedId);(map.getSource('selected') as GeoJSONSource)?.setData(data(point?[point]:[]) as any);}
    function area(){const b=map.getBounds();const ids=props.points.filter((p:Point)=>b.contains([p.lon,p.lat])).map((p:Point)=>p.id);return {ids,bounds:{west:b.getWest(),east:b.getEast(),south:b.getSouth(),north:b.getNorth()},center:{lat:map.getCenter().lat,lon:map.getCenter().lng},zoom:map.getZoom()-1.4};}
    map.on('load',()=>{if(disposed)return;ready=true;(map.getSource('stations') as GeoJSONSource).setData(data(props.points) as any);syncSelection();map.triggerRepaint();props.onReady?.(area());});
    map.on('dragstart',()=>{userMoved=true;});
    map.on('zoomstart',e=>{if(e.originalEvent)userMoved=true;});
    map.on('moveend',()=>{if(!ready||disposed)return;props.onZoomChange?.(map.getZoom()-1.4);props.onCamera?.({center:{lat:map.getCenter().lat,lon:map.getCenter().lng},zoom:map.getZoom()-1.4});if(userMoved){userMoved=false;props.onAreaChange?.(area());}});
    map.on('click',async e=>{
      if(!ready)return;
      const selected=map.queryRenderedFeatures(e.point,{layers:['selection-halo']})[0];
      if(selected){props.onPick?.(selected.properties.id);return;}
      const revision=++selectionRevision;
      const box:[[number,number],[number,number]]=[[e.point.x-22,e.point.y-22],[e.point.x+22,e.point.y+22]];
      const hits=map.queryRenderedFeatures(box,{layers:['groups','dots']});
      if(!hits.length)return;
      hits.sort((a,b)=>{const pa=map.project((a.geometry as any).coordinates),pb=map.project((b.geometry as any).coordinates);return Math.hypot(pa.x-e.point.x,pa.y-e.point.y)-Math.hypot(pb.x-e.point.x,pb.y-e.point.y);});
      const hit=hits[0],source=map.getSource('stations') as GeoJSONSource;
      try{
        if(hit.properties.cluster){
          const [leaves,zoom]=await Promise.all([source.getClusterLeaves(hit.properties.cluster_id,hit.properties.point_count,0),source.getClusterExpansionZoom(hit.properties.cluster_id)]);
          if(disposed||revision!==selectionRevision)return;
          props.onGroup?.(leaves.map(p=>p.properties.id));
          map.easeTo({center:(hit.geometry as any).coordinates,zoom:Math.min(zoom,15),duration:reduce()?0:600});
        }else{
          const candidates=hits.filter(p=>!p.properties.cluster).map(p=>p.properties.id);
          const unique=[...new Set(candidates)];
          if(unique.length>1)props.onGroup?.(unique);else props.onPick?.(hit.properties.id);
        }
      }catch{if(!disposed)props.onError?.('Не удалось раскрыть группу. Приблизьте карту кнопкой +.');}
    });
    const pointer=()=>{map.getCanvas().style.cursor='pointer';},reset=()=>{map.getCanvas().style.cursor='';};
    for(const layer of ['groups','dots']){map.on('mouseenter',layer,pointer);map.on('mouseleave',layer,reset);}
    // Keep the app's cold globe first-frame workaround, bounded to this mount.
    let kicked=false;const kick=()=>{if(kicked||disposed)return;kicked=true;requestAnimationFrame(()=>{if(disposed)return;const c=map.getCenter();map.easeTo({center:[c.lng+.0001,c.lat],duration:0});map.easeTo({center:[c.lng,c.lat],duration:0});});};
    const satelliteData=(e:any)=>{if(e.sourceId==='satellite'){map.triggerRepaint();kick();}};map.on('sourcedata',satelliteData);
    let attempts=0;const warm=setInterval(()=>{if(disposed)return;map.triggerRepaint();if(++attempts===4)kick();if(attempts>=12){clearInterval(warm);map.off('sourcedata',satelliteData);}},250);
    const resize=new ResizeObserver(()=>{if(!disposed)map.resize();});resize.observe(host);
    return {
      update(next:any){
        if(disposed)return;if(next.userMove)userMoved=true;const pointsChanged=next.points&&next.points!==props.points;props={...props,...next};
        if(ready){if(pointsChanged){selectionRevision++;(map.getSource('stations') as GeoJSONSource).setData(data(props.points) as any);}syncSelection();}
        if(next.focusPoint||typeof next.zoomLevel==='number')map.easeTo({...(next.focusPoint?{center:[next.focusPoint.lon,next.focusPoint.lat] as [number,number]}:{}),...(typeof next.zoomLevel==='number'?{zoom:next.zoomLevel+1.4}:{}),duration:reduce()?0:650});
      },
      area:()=>{map.stop();return area();},
      destroy(){disposed=true;clearInterval(warm);resize.disconnect();map.remove();}
    };
  }
};
