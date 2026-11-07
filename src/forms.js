/** Frio Tickets — formulários por departamento (0 a 10 perguntas) */
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export const MAX_QUESTIONS = 10;
export const DEFAULT_QUESTIONS = [{ label: 'Descreva sua solicitação', placeholder: '', style: 'paragraph', required: true }];
const cut = (v, n) => String(v ?? '').slice(0, n);

/** Lê as perguntas do departamento. Coluna ausente (banco antigo) = 1 pergunta legada. [] = sem formulário. */
export function getQuestions(dept) {
  if (Array.isArray(dept?.form_questions)) {
    return dept.form_questions
      .filter(q => q && String(q.label || '').trim())
      .slice(0, MAX_QUESTIONS)
      .map(q => ({ label: cut(q.label, 45), placeholder: cut(q.placeholder, 100), style: q.style === 'short' ? 'short' : 'paragraph', required: q.required !== false }));
  }
  return [{ ...DEFAULT_QUESTIONS[0], label: cut(dept?.form_question || DEFAULT_QUESTIONS[0].label, 45) }];
}

/** Modal com até 5 perguntas (limite do Discord). page 0 = perguntas 1–5, page 1 = 6–10. */
export function formModal(deptId, questions, page, deptName) {
  const title = questions.length > 5 ? `(${page + 1}/2) ${deptName}` : `Abrir ticket • ${deptName}`;
  const modal = new ModalBuilder().setCustomId(`tk:form:${deptId}:${page}`).setTitle(cut(title, 45));
  questions.slice(page * 5, page * 5 + 5).forEach((q, idx) => {
    const input = new TextInputBuilder()
      .setCustomId(`q${page * 5 + idx}`)
      .setLabel(q.label)
      .setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setRequired(q.required)
      .setMaxLength(q.style === 'short' ? 200 : 1000);
    if (q.placeholder) input.setPlaceholder(q.placeholder);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  return modal;
}

export function readAnswers(interaction, questions, page) {
  return questions.slice(page * 5, page * 5 + 5)
    .map((q, idx) => ({ label: q.label, value: interaction.fields.getTextInputValue(`q${page * 5 + idx}`).trim() }))
    .filter(a => a.value);
}

// Respostas da 1ª página enquanto o usuário preenche a 2ª (10 min).
const pending = new Map();
export const stashAnswers = (key, answers) => pending.set(key, { answers, time: Date.now() });
export const takeAnswers = key => { const x = pending.get(key); pending.delete(key); return x && Date.now() - x.time < 600000 ? x.answers : null; };
setInterval(() => { for (const [k, v] of pending) if (Date.now() - v.time > 600000) pending.delete(k); }, 300000).unref();
