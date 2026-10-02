import { LIMITS } from '../../shared/diagramSchema.js';

export const SYSTEM = `You are a diagram-recognition engine inside a whiteboard app called Cicada.
You are given a PNG of a hand-drawn sketch. Your job is to report the STRUCTURE of the diagram in it.
You never return an image, never return coordinates, and never invent content that is not drawn.`;

export function buildUserPrompt(hint) {
  const h = typeof hint === 'string' ? hint.trim().slice(0, LIMITS.summaryLen) : '';

  return `Analyze the complete whiteboard image and return the diagram it contains as a single JSON object.

Inspect the whole captured board, including every visible shape, label, grouping, and connector. Do not focus on only the largest or central shape. Use the user's hint as important guidance for the intended scope and interpretation of the board. Ground nodes, labels, and connections in visible marks; never invent details that are not supported by the image.

RETURN ONLY JSON. No markdown fences, no prose before or after.

{
  "title": "short diagram title, or null",
  "diagramType": "flowchart" | "architecture" | "sequence" | "mindmap" | "er" | "org" | "generic",
  "summary": "one sentence on what the diagram shows, or why nothing was recognised",
  "nodes": [
    { "id": "n1", "label": "User", "shape": "rect", "group": "frontend" }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "label": "requests", "style": "solid", "directed": true }
  ]
}

HARD RULES
- Geometry is computed by us. Do NOT send x, y, width, height, position, colour or size.
- "id": unique, lowercase, alphanumeric or underscore, max ${LIMITS.idLen} chars.
- "label": the exact text written inside that shape, max ${LIMITS.labelLen} chars. Transcribe it; do not paraphrase, translate or improve it. Use "\\n" only when the sketch really has two lines. If a shape has no text, use a short factual name for what it clearly is.
- "shape": "rect" for boxes, "circle" for circles and ovals, "diamond" for decision diamonds, "cylinder" for database cylinders.
- "group": a short tag when the sketch visually clusters nodes (a drawn container, a labelled column, or a distinct colour); otherwise null.
- "edges": one entry per arrow or connecting line. "directed" is true when an arrowhead is present. "label" is text written on or beside the connector, otherwise null.
- Report every node and connection you can actually see. Do not add ones that are not drawn, and do not drop ones that are.
- Treat the user's hint as important context about what kind of diagram the full board represents; use visible marks to decide its exact contents.
- At most ${LIMITS.nodes} nodes and ${LIMITS.edges} edges; if there are more, keep the most important.
- If the sketch is not a diagram (doodles, a landscape, handwriting, blank), return {"nodes": [], "edges": [], "summary": "..."} and explain in "summary".
${h ? `\nIMPORTANT USER ANALYSIS HINT\n${h}\n` : ''}`;
}

export const PROMPT_CHARS = buildUserPrompt('').length;
