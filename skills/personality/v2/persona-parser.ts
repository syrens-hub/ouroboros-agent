export interface PersonaProfile {
  name: string;
  essence: string;
  traits: Record<string, string>;
  speechPatterns: string[];
}

export function parsePersona(mdContent: string): PersonaProfile {
  const profile: PersonaProfile = {
    name: "",
    essence: "",
    traits: {},
    speechPatterns: [],
  };

  const lines = mdContent.split("\n");
  let currentSection = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("# ")) {
      const h1 = line.slice(2).trim();
      const nameMatch = h1.match(/(?:我是|我叫|Name[:：]\s*)?\s*(.+)/);
      if (nameMatch && !profile.name) {
        profile.name = nameMatch[1].trim();
      }
      continue;
    }

    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim();
      continue;
    }

    if (currentSection === "核心身份" || currentSection === "Core Identity") {
      const essenceMatch = line.match(/(?:本质|Essence)[:：]\s*(.+)/);
      if (essenceMatch) {
        profile.essence = essenceMatch[1].trim();
      }
      const nameMatch = line.match(/(?:名字|Name)[:：]\s*(.+)/);
      if (nameMatch) {
        profile.name = nameMatch[1].trim();
      }
      continue;
    }

    if (
      currentSection === "性格特征" ||
      currentSection === "Traits" ||
      currentSection === "Personality Traits"
    ) {
      const traitMatch = line.match(/^-\s+([^：:]+)[:：]\s*(.+)/);
      if (traitMatch) {
        profile.traits[traitMatch[1].trim()] = traitMatch[2].trim();
      }
      continue;
    }

    if (
      currentSection === "说话风格" ||
      currentSection === "Speech Patterns" ||
      currentSection === "Speech"
    ) {
      if (line.startsWith("- ")) {
        profile.speechPatterns.push(line.slice(2).trim());
      }
      continue;
    }
  }

  return profile;
}
