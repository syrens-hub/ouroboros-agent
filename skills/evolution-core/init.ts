/**
 * Evolution Core Initialisation
 * =============================
 * Registers all evolution-cluster modules into the DI registry.
 *
 * Import this file once at application startup (e.g. from main.ts)
 * before any evolution pipeline runs.
 */

import { registerEvolutionModule } from "./registry.ts";

import * as semanticConstitution from "../semantic-constitution/index.ts";
import * as safetyControls from "../safety-controls/index.ts";
import * as approval from "../approval/index.ts";
import * as versionManager from "../evolution-version-manager/index.ts";
import * as incrementalTest from "../incremental-test/index.ts";
import * as consensus from "../evolution-consensus/index.ts";
import * as memory from "../evolution-memory/index.ts";
import * as selfModify from "../self-modify/index.ts";
import * as selfHealing from "../self-healing/index.ts";
import * as crewai from "../crewai/consensus-engine.ts";
import * as orchestrator from "../evolution-orchestrator/index.ts";

registerEvolutionModule("semanticConstitution", semanticConstitution);
registerEvolutionModule("safetyControls", safetyControls);
registerEvolutionModule("approval", approval);
registerEvolutionModule("versionManager", versionManager);
registerEvolutionModule("incrementalTest", incrementalTest);
registerEvolutionModule("consensus", consensus);
registerEvolutionModule("memory", memory);
registerEvolutionModule("selfModify", selfModify);
registerEvolutionModule("selfHealing", selfHealing);
registerEvolutionModule("crewai", crewai);
registerEvolutionModule("orchestrator", orchestrator);
