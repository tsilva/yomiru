export const verbGroupLabels = {
  godan: "Godan",
  ichidan: "Ichidan",
  irregular: "Irregular",
};

function rules(use, godan, ichidan, irregular) {
  return { use, groups: { godan, ichidan, irregular } };
}

function politeStem(use, ending) {
  return rules(use, `Move the last sound to the **i-row** (**ku** → **ki**) and add **${ending}**.`,
    `Replace final **ru** with **${ending}**.`, `Use the **special polite stem** and add **${ending}**.`);
}

export const conjugationGuides = {
  "plain-negative": rules("Say that you do not or will not do something.",
    "Move the last sound to its **a-row** sound and add **nai**. Final **u** changes to **wa**. A few verbs have a special negative.",
    "Replace final **ru** with **nai**.", "Use the **special negative stem** and add **nai**."),
  "polite-nonpast": politeStem("Say what you do or will do, politely.", "masu"),
  "plain-past": rules("Say what you did.",
    "Make the **te-form**, then change final **te** to **ta** or **de** to **da**.",
    "Replace final **ru** with **ta**.", "Use the **special te-form** and change final **te** to **ta**."),
  "polite-past": politeStem("Say what you did, politely.", "mashita"),
  "plain-past-negative": {
    use: "Say that you did not do something.",
    common: "Make the **plain negative** and replace final **nai** with **nakatta**.",
  },
  "polite-negative": politeStem("Say that you do not or will not do something, politely.", "masen"),
  "polite-past-negative": politeStem("Say that you did not do something, politely.", "masen deshita"),
  te: rules("Link actions or build forms like “is doing.”",
    "Match the final sound. **u**, **tsu**, **ru** → **tte** / **mu**, **bu**, **nu** → **nde** / **ku** → **ite** / **gu** → **ide** / **su** → **shite**. Some verbs use a special ending.",
    "Replace final **ru** with **te**.", "Use the **special te stem** and add **te**."),
  "plain-ongoing": { use: "Say what you are doing.", common: "Make the **te-form** and add **iru**." },
  "polite-ongoing": { use: "Say what you are doing, politely.", common: "Make the **te-form** and add **imasu**." },
  "plain-potential": rules("Say what you can do.",
    "Move the last sound to its **e-row** sound and add **ru**.",
    "Replace final **ru** with **rareru**.", "Use the **special potential stem** and add **ru**."),
  "polite-potential": rules("Say what you can do, politely.",
    "Move the last sound to its **e-row** sound and add **masu**.",
    "Replace final **ru** with **raremasu**.", "Use the **special potential stem** and add **masu**."),
  "plain-volitional": rules("Suggest “let’s” or say what you intend to do.",
    "Move the last sound to its **o-row** sound and add **u**.",
    "Replace final **ru** with **you**.", "Use the **special volitional stem** and add **you**."),
  "polite-volitional": politeStem("Suggest “let’s,” politely.", "mashou"),
  conditional: rules("Say “if” you do something.",
    "Move the last sound to its **e-row** sound and add **ba**.",
    "Replace final **ru** with **reba**.", "Replace final **ru** with **reba**."),
  "plain-desire": politeStem("Say what you want to do.", "tai"),
  "polite-desire": politeStem("Say what you want to do, politely.", "tai desu"),
};
