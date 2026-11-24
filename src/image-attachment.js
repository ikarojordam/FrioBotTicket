// Detecta somente anexos de imagem. Não interpreta o conteúdo visual.
export function imageAttachment(message){
 return message.attachments?.find(a=>{
  const type=String(a.contentType||'').toLowerCase();
  const name=String(a.name||'').toLowerCase();
  return type.startsWith('image/')||/\.(?:png|jpe?g|webp|gif)$/i.test(name);
 })||null;
}
