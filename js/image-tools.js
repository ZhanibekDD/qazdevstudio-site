(function(){
  var input=document.getElementById('imageInput');
  var drop=document.getElementById('dropZone');
  var preview=document.getElementById('preview');
  var previewImage=document.getElementById('previewImage');
  var fileName=document.getElementById('fileName');
  var originalInfo=document.getElementById('originalInfo');
  var replace=document.getElementById('replaceFile');
  var form=document.getElementById('imageForm');
  var width=document.getElementById('widthInput');
  var height=document.getElementById('heightInput');
  var ratio=document.getElementById('keepRatio');
  var format=document.getElementById('formatSelect');
  var quality=document.getElementById('qualityInput');
  var qualityValue=document.getElementById('qualityValue');
  var process=document.getElementById('processButton');
  var status=document.getElementById('statusText');
  var error=document.getElementById('errorText');
  var result=document.getElementById('resultPanel');
  var resultImage=document.getElementById('resultImage');
  var download=document.getElementById('downloadResult');
  var another=document.getElementById('processAnother');
  var sourceFile=null,sourceImage=null,sourceUrl=null,resultUrl=null,originalRatio=1,changing=false;

  function bytes(value){if(value<1024)return value+' Б';if(value<1048576)return (value/1024).toFixed(1)+' КБ';return (value/1048576).toFixed(2)+' МБ'}
  function fail(message){error.textContent=message;error.hidden=false;status.textContent='Ошибка'}
  function clearError(){error.hidden=true;error.textContent=''}
  function extension(type){return type==='image/jpeg'?'jpg':type==='image/png'?'png':'webp'}
  function selectFile(file){
    clearError();
    if(!file||!file.type.startsWith('image/')){fail('Выберите изображение JPG, PNG, WebP или другой формат, который открывает браузер.');return}
    if(file.size>40*1024*1024){fail('Файл больше 40 МБ. Для стабильной работы выберите изображение меньшего размера.');return}
    if(sourceUrl)URL.revokeObjectURL(sourceUrl);
    sourceFile=file;sourceUrl=URL.createObjectURL(file);
    var image=new Image();
    image.onload=function(){
      sourceImage=image;originalRatio=image.naturalWidth/image.naturalHeight;
      width.value=image.naturalWidth;height.value=image.naturalHeight;
      previewImage.src=sourceUrl;fileName.textContent=file.name;
      originalInfo.textContent=image.naturalWidth+' × '+image.naturalHeight+' px · '+bytes(file.size);
      drop.hidden=true;preview.hidden=false;process.disabled=false;status.textContent='Готов к обработке';result.hidden=true;
    };
    image.onerror=function(){fail('Браузер не смог открыть это изображение. Попробуйте JPG, PNG или WebP.')};
    image.src=sourceUrl;
  }
  drop.addEventListener('click',function(){input.click()});
  replace.addEventListener('click',function(){input.click()});
  input.addEventListener('change',function(){selectFile(input.files[0])});
  ['dragenter','dragover'].forEach(function(name){drop.addEventListener(name,function(event){event.preventDefault();drop.classList.add('is-dragover')})});
  ['dragleave','drop'].forEach(function(name){drop.addEventListener(name,function(event){event.preventDefault();drop.classList.remove('is-dragover')})});
  drop.addEventListener('drop',function(event){selectFile(event.dataTransfer.files[0])});
  window.addEventListener('paste',function(event){var file=Array.from(event.clipboardData&&event.clipboardData.files||[]).find(function(item){return item.type.startsWith('image/')});if(file)selectFile(file)});
  width.addEventListener('input',function(){if(!ratio.checked||changing||!originalRatio)return;changing=true;height.value=Math.max(1,Math.round(Number(width.value)/originalRatio));changing=false});
  height.addEventListener('input',function(){if(!ratio.checked||changing||!originalRatio)return;changing=true;width.value=Math.max(1,Math.round(Number(height.value)*originalRatio));changing=false});
  quality.addEventListener('input',function(){qualityValue.textContent=quality.value+'%'});
  format.addEventListener('change',function(){quality.disabled=format.value==='image/png';qualityValue.textContent=format.value==='image/png'?'без потерь':quality.value+'%'});

  form.addEventListener('submit',function(event){
    event.preventDefault();clearError();
    if(!sourceImage||!sourceFile)return fail('Сначала выберите изображение.');
    var w=Math.round(Number(width.value)),h=Math.round(Number(height.value));
    if(!w||!h||w<1||h<1||w>16000||h>16000)return fail('Укажите размер от 1 до 16 000 пикселей.');
    status.textContent='Обработка…';process.disabled=true;
    try{
      var canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      var context=canvas.getContext('2d',{alpha:format.value!=='image/jpeg'});
      if(format.value==='image/jpeg'){context.fillStyle='#ffffff';context.fillRect(0,0,w,h)}
      context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(sourceImage,0,0,w,h);
      canvas.toBlob(function(blob){
        process.disabled=false;
        if(!blob)return fail('Не удалось создать файл. Возможно, изображение слишком большое для памяти браузера.');
        if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=URL.createObjectURL(blob);
        resultImage.src=resultUrl;download.href=resultUrl;
        var base=sourceFile.name.replace(/\.[^.]+$/,'');download.download=base+'-qaztools.'+extension(format.value);
        document.getElementById('beforeSize').textContent=bytes(sourceFile.size);
        document.getElementById('afterSize').textContent=bytes(blob.size);
        var saved=Math.round((1-blob.size/sourceFile.size)*100);
        document.getElementById('savedPercent').textContent=(saved>=0?saved+'%':'+'+Math.abs(saved)+'%');
        document.getElementById('resultDimensions').textContent=w+' × '+h;
        document.getElementById('savingTitle').textContent=saved>0?'Файл стал легче на '+saved+'%':'Новый файл готов';
        result.hidden=false;status.textContent='Готово';result.scrollIntoView({behavior:'smooth',block:'center'});
      },format.value,format.value==='image/png'?undefined:Number(quality.value)/100);
    }catch(exception){process.disabled=false;fail('Ошибка обработки: '+exception.message)}
  });
  another.addEventListener('click',function(){result.hidden=true;input.value='';drop.hidden=false;preview.hidden=true;process.disabled=true;status.textContent='Ожидает файл';sourceFile=null;sourceImage=null;window.scrollTo({top:drop.getBoundingClientRect().top+scrollY-120,behavior:'smooth'})});
})();
