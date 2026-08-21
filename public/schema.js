// Shared field schema — mirrors Chegutu_Livestock_Checklist_XLSForm.xlsx field-for-field,
// so the digital form and the KoboToolbox form stay in sync.
window.LIVESTOCK_SCHEMA = {
  formTitle: "Chegutu Livestock Census — FFS",
  formId: "chegutu_livestock_ffs",
  version: "2026081601",

  frontMatter: [
    { name: "district", label: "District", type: "fixed", value: "Chegutu" },
    { name: "ward", label: "Ward number", type: "integer", required: true, min: 1, max: 30,
      hint: "Enter the Chegutu ward number." },
    { name: "village", label: "Village / area name", type: "text", required: true },
    { name: "household_id", label: "Household / homestead ID", type: "text", required: true,
      hint: "Use the ward's existing homestead numbering if one exists." },
    { name: "household_head_name", label: "Name of household head", type: "text", required: true },
    { name: "respondent_name", label: "Name of respondent (if different)", type: "text" },
    { name: "respondent_contact", label: "Respondent phone number", type: "text" },
    { name: "enumerator_name", label: "Enumerator / councillor name", type: "text", required: true },
    { name: "collection_date", label: "Date of visit", type: "date", required: true },
    { name: "gps_location", label: "GPS location of homestead", type: "geopoint" }
  ],

  choices: {
    dairy_breed: [
      ["holstein", "Holstein"], ["jersey", "Jersey"], ["brown_swiss", "Brown Swiss"],
      ["red_dane", "Red Dane"], ["crossbreed", "Crossbreed"], ["other", "Other"]
    ],
    goat_breed: [
      ["mashona", "Mashona (indigenous)"], ["matebele", "Matebele (indigenous)"],
      ["boer", "Boer"], ["kalahari_red", "Kalahari Red"], ["saanen", "Saanen"],
      ["crossbreed", "Crossbreed"], ["other", "Other"]
    ],
    hive_type: [
      ["langstroth", "Langstroth (movable frame)"], ["kenya_top_bar", "Kenya top-bar"],
      ["traditional_log", "Traditional log/bark hive"], ["other", "Other"]
    ],
    aquaculture_type: [
      ["earthen_pond", "Earthen pond"], ["concrete_tank", "Concrete tank"],
      ["plastic_tank", "Plastic/mobile tank"], ["cage_culture", "Cage culture"], ["other", "Other"]
    ],
    aquatic_plant_type: [
      ["water_spinach", "Water spinach (morning glory)"], ["azolla", "Azolla"],
      ["duckweed", "Duckweed"], ["water_hyacinth_invasive", "Water hyacinth (invasive - control only)"],
      ["other", "Other"]
    ]
  },

  groups: [
    { key: "beef_cattle", label: "Beef cattle", hasField: "has_beef_cattle", fields: [
      { name: "beef_bulls", label: "Number of bulls", type: "integer", hint: "Mature uncastrated males." },
      { name: "beef_cows", label: "Number of cows", type: "integer", hint: "Mature females that have calved." },
      { name: "beef_heifers", label: "Number of heifers", type: "integer", hint: "Young females, not yet calved." },
      { name: "beef_calves", label: "Number of calves", type: "integer", hint: "Under 1 year old." },
      { name: "beef_oxen", label: "Number of oxen", type: "integer", hint: "Castrated males, incl. draught/trained animals." }
    ]},
    { key: "dairy_cattle", label: "Dairy cattle", hasField: "has_dairy_cattle", fields: [
      { name: "dairy_breed", label: "Dairy breed", type: "select_one", choices: "dairy_breed" },
      { name: "dairy_cows", label: "Number of dairy cows (milking herd)", type: "integer" },
      { name: "dairy_heifers", label: "Number of dairy heifers", type: "integer" }
    ]},
    { key: "donkeys", label: "Donkeys", hasField: "has_donkeys", fields: [
      { name: "donkey_jacks", label: "Number of jacks", type: "integer", hint: "Male donkeys." }
    ]},
    { key: "goats", label: "Goats", hasField: "has_goats", fields: [
      { name: "goat_breed", label: "Predominant goat breed", type: "select_one", choices: "goat_breed" },
      { name: "goat_bucks", label: "Number of bucks", type: "integer", hint: "Mature males." },
      { name: "goat_does", label: "Number of does", type: "integer", hint: "Mature females." },
      { name: "goat_kids", label: "Number of kids", type: "integer", hint: "Under 1 year old." }
    ]},
    { key: "sheep", label: "Sheep", hasField: "has_sheep", fields: [
      { name: "sheep_rams", label: "Number of rams", type: "integer" },
      { name: "sheep_ewes", label: "Number of ewes", type: "integer" },
      { name: "sheep_lambs", label: "Number of lambs", type: "integer" }
    ]},
    { key: "pigs", label: "Pigs", hasField: "has_pigs", fields: [
      { name: "pig_boars", label: "Number of boars", type: "integer" },
      { name: "pig_sows", label: "Number of sows", type: "integer" },
      { name: "pig_gilts", label: "Number of gilts", type: "integer", hint: "Young females, not yet farrowed." },
      { name: "pig_piglets", label: "Number of piglets", type: "integer" },
      { name: "pig_fatteners", label: "Number of fatteners", type: "integer" }
    ]},
    { key: "poultry", label: "Poultry", hasField: "has_poultry", fields: [
      { name: "poultry_road_runners", label: "Number of road runners", type: "integer", hint: "Indigenous free-range chickens." },
      { name: "poultry_turkeys", label: "Number of turkeys", type: "integer" },
      { name: "poultry_ducks", label: "Number of ducks", type: "integer" },
      { name: "poultry_guinea_fowl", label: "Number of guinea fowl", type: "integer" }
    ]},
    { key: "bees", label: "Bees", hasField: "has_bees", fields: [
      { name: "hive_type", label: "Predominant hive type", type: "select_one", choices: "hive_type" },
      { name: "colonized_hives", label: "Number of colonized hives", type: "integer" },
      { name: "uncolonized_hives", label: "Number of uncolonized hives", type: "integer" }
    ]},
    { key: "aquaculture", label: "Aquaculture", hasField: "has_aquaculture", fields: [
      { name: "aquaculture_type", label: "Aquaculture type", type: "select_one", choices: "aquaculture_type" }
    ]},
    { key: "aquatic_plants", label: "Aquatic plants", hasField: "has_aquatic_plants", fields: [
      { name: "aquatic_plant_type", label: "Aquatic plant type", type: "select_one", choices: "aquatic_plant_type" },
      { name: "aquatic_plant_ponds", label: "Number of ponds", type: "integer" },
      { name: "aquatic_plant_area", label: "Total ponds area (m²)", type: "decimal" }
    ]},
    { key: "rabbits", label: "Rabbits", hasField: "has_rabbits", fields: [
      { name: "rabbit_bucks", label: "Number of bucks", type: "integer", hint: "Male rabbits." },
      { name: "rabbit_does", label: "Number of does", type: "integer", hint: "Female rabbits." },
      { name: "rabbit_bunnies", label: "Number of bunnies", type: "integer", hint: "Young rabbits." }
    ]}
  ]
};
