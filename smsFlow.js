// Server-side port of the USSD/SMS self-report conversation used in the interactive
// demo (Chegutu_Livestock_App_Demo.html's "Self-Report" tab). Same steps, same copy,
// same validation — this version drives a real Telerivet webhook instead of a
// browser mock, and hands a finished report to `onSubmit` instead of an in-memory array.
//
// Covers the three fast-changing herds the self-report concept note scopes this
// channel to (rabbits, poultry, goats) — cattle and the rest stay a field-visit
// exercise. See self_report_strategy.pdf for why.

const SELF_REPORT_SPECIES = [
  { key: "rabbits", label: "Rabbits", hasField: "has_rabbits",
    promptLine: "Reply with 3 numbers separated by commas - bucks,does,bunnies (e.g. 2,4,6)",
    fields: ["rabbit_bucks", "rabbit_does", "rabbit_bunnies"], labels: ["bucks", "does", "bunnies"] },
  { key: "poultry", label: "Poultry", hasField: "has_poultry",
    promptLine: "Reply with 4 numbers separated by commas - road runners,turkeys,ducks,guinea fowl (e.g. 10,0,2,0)",
    fields: ["poultry_road_runners", "poultry_turkeys", "poultry_ducks", "poultry_guinea_fowl"],
    labels: ["road runners", "turkeys", "ducks", "guinea fowl"] },
  { key: "goats", label: "Goats", hasField: "has_goats",
    promptLine: "Reply with 3 numbers separated by commas - bucks,does,kids (e.g. 1,4,2)",
    fields: ["goat_bucks", "goat_does", "goat_kids"], labels: ["bucks", "does", "kids"] }
];

function parseCounts(reply, n) {
  const parts = reply.split(",").map((s) => s.trim());
  if (parts.length !== n) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : null));
  return nums.includes(null) ? null : nums;
}

const STEPS = {
  welcome: {
    onEnter: (ctx) => { Object.keys(ctx).forEach((k) => delete ctx[k]); },
    prompt: () => "Welcome to Chegutu Livestock Line.\n1. Report my livestock\n2. Check my last report",
    handle: (reply) => {
      const r = reply.trim();
      if (r === "1") return "ask_id";
      if (r === "2") return "check_last";
      return null;
    },
    errorMsg: "Reply 1 or 2."
  },
  // Looks up the most recent SMS self-report actually on file for this phone
  // number (via opts.getLastReport, set on onEnter below) rather than always
  // claiming none exists.
  check_last: {
    onEnter: (ctx, opts, phone) => {
      ctx.lastReport = (opts && typeof opts.getLastReport === "function") ? opts.getLastReport(phone) : null;
    },
    prompt: (ctx) => {
      const r = ctx.lastReport;
      if (!r) return "No previous self-report found for this number. Reply 9 to return to the menu.";
      const speciesLabel = (r.species && r.species[0]) || "livestock";
      const when = new Date(r.received_at).toLocaleDateString();
      const status = r.verified === false ? "pending review" : "verified";
      return `Your last self-report: ${speciesLabel} on ${when} (${status}). Reply 9 to return to the menu.`;
    },
    handle: (reply) => (reply.trim() === "9" ? "welcome" : null),
    errorMsg: "Reply 9 to return to the menu."
  },
  ask_id: {
    prompt: () => "Enter your Household ID from your ward card, or reply 0 if you don't have one.",
    handle: (reply, ctx) => {
      const r = reply.trim();
      if (!r) return null;
      ctx.household_id = r === "0" ? "SR-" + Math.floor(1000 + Math.random() * 9000) : r;
      return "ask_ward";
    },
    errorMsg: "Please enter your Household ID, or 0."
  },
  ask_ward: {
    prompt: () => "What is your ward number?",
    handle: (reply, ctx) => {
      const n = parseInt(reply.trim(), 10);
      if (isNaN(n) || n < 1 || n > 30) return null;
      ctx.ward = String(n);
      return "ask_name";
    },
    errorMsg: "Enter a ward number between 1 and 30."
  },
  ask_name: {
    prompt: () => "What is your name?",
    handle: (reply, ctx) => {
      if (reply.trim().length < 2) return null;
      ctx.household_head_name = reply.trim();
      return "ask_village";
    },
    errorMsg: "Please enter your name."
  },
  ask_village: {
    prompt: () => "Which village or area?",
    handle: (reply, ctx) => {
      if (reply.trim().length < 2) return null;
      ctx.village = reply.trim();
      return "species_menu";
    },
    errorMsg: "Please enter your village or area."
  },
  species_menu: {
    prompt: (ctx) => `What would you like to report today, ${ctx.household_head_name}?\n1. Rabbits\n2. Poultry\n3. Goats\n4. Something else (a councillor will visit)`,
    handle: (reply, ctx) => {
      const r = reply.trim();
      const map = { 1: 0, 2: 1, 3: 2 };
      if (r in map) { ctx.species = SELF_REPORT_SPECIES[map[r]]; return "counts"; }
      if (r === "4") return "flag_visit";
      return null;
    },
    errorMsg: "Reply 1, 2, 3 or 4."
  },
  counts: {
    prompt: (ctx) => ctx.species.promptLine,
    handle: (reply, ctx) => {
      const nums = parseCounts(reply, ctx.species.fields.length);
      if (!nums) return null;
      ctx.counts = nums;
      return "confirm";
    },
    errorMsg: "Please enter the right number of values, separated by commas - e.g. 2,4,6."
  },
  flag_visit: {
    prompt: () => "Noted - we've flagged your homestead for a councillor visit to record this in person. Reply 9 to return to the menu.",
    handle: (reply) => (reply.trim() === "9" ? "welcome" : null),
    errorMsg: "Reply 9 to return to the menu."
  },
  confirm: {
    prompt: (ctx) => {
      const parts = ctx.species.labels.map((l, i) => `${ctx.counts[i]} ${l}`).join(", ");
      return `You reported ${ctx.species.label} - ${parts} - for ${ctx.household_head_name}, Ward ${ctx.ward}, ${ctx.village}.\n1. Confirm and submit\n2. Cancel and start over`;
    },
    handle: (reply) => {
      const r = reply.trim();
      if (r === "1") return "done";
      if (r === "2") return "welcome";
      return null;
    },
    errorMsg: "Reply 1 to confirm or 2 to cancel."
  },
  done: {
    // onSubmit is injected per-call by handleIncoming (closures over the caller's ctx/opts).
    prompt: () => "Thank you! Your report has been saved as unverified, pending a councillor's review. Reply 9 to start a new report.",
    handle: (reply) => (reply.trim() === "9" ? "welcome" : null),
    errorMsg: "Reply 9 to start a new report."
  }
};

/**
 * Process one inbound SMS for a given phone number against its in-progress session.
 * @param {Map} sessionStore - Map<phoneNumber, {stepId, ctx}>, owned by the caller.
 * @param {string} phone - sender's phone number (used as the session key).
 * @param {string} text - the SMS body.
 * @param {{onSubmit: (data: object) => void, getLastReport?: (phone: string) => object|null}} opts -
 *   onSubmit is called once when a report is confirmed; getLastReport backs the
 *   "Check my last report" menu option.
 * @returns {string} the reply text to send back.
 */
function handleIncoming(sessionStore, phone, text, opts) {
  let session = sessionStore.get(phone);

  // First-ever contact from this number: show the welcome menu unconditionally,
  // rather than evaluating their opening text (which might be "hi", "LIVESTOCK", etc.)
  // as a reply to a step they've never seen.
  if (!session) {
    session = { stepId: "welcome", ctx: {} };
    sessionStore.set(phone, session);
    return STEPS.welcome.prompt(session.ctx, opts, phone);
  }

  const step = STEPS[session.stepId];
  const next = step.handle(text || "", session.ctx, opts, phone);
  if (!next) return step.errorMsg || "Sorry, that wasn't valid - try again.";

  session.stepId = next;
  const nextStep = STEPS[next];
  if (next === "done" && !session.ctx.submitted) {
    session.ctx.submitted = true;
    const ctx = session.ctx;
    const data = {
      district: "Chegutu", ward: ctx.ward, village: ctx.village, household_id: ctx.household_id,
      household_head_name: ctx.household_head_name, respondent_contact: phone,
      enumerator_name: "(farmer self-report)", collection_date: new Date().toISOString().slice(0, 10),
      field_notes: ""
    };
    data[ctx.species.hasField] = "yes";
    ctx.species.fields.forEach((fname, i) => { data[fname] = String(ctx.counts[i]); });
    opts.onSubmit(data);
  }
  if (nextStep.onEnter) nextStep.onEnter(session.ctx, opts, phone);
  return nextStep.prompt(session.ctx, opts, phone);
}

module.exports = { handleIncoming, SELF_REPORT_SPECIES, STEPS };
