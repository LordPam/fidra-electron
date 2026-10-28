import { AiBridge } from '../src/main/services/ai-bridge';
import { aiToolCatalog } from '../src/main/services/ai-tool-catalog';
process.stdout.write(JSON.stringify(aiToolCatalog(new AiBridge({ isCurrent: () => false, isPreparing: () => true, onChanged: () => undefined })), null, 2));
