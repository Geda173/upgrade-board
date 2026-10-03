/**
 * "Which one?" — asks the buyer to nominate a document as part of a purchase.
 *
 * Deliberately runs on the buyer's own client, before the request is sent to the GM. Prompting
 * from the GM-side pipeline would need a request/response round trip over the socket; asking
 * first and sending the answer along with the request needs none.
 */
import { wireDropZone } from "./ui.js";
import { t } from "../i18n.js";

const { DialogV2 } = foundry.applications.api;

/**
 * @returns {Promise<{uuid: string, name: string, img: string}|null>}
 *   null when the buyer cancels, which aborts the purchase before anything is spent.
 */
export async function promptForDocument({ label, hint, accept = [], validate = null } = {}) {
  let picked = null;

  const content = `
    <p class="upg-hint">${foundry.utils.escapeHTML(hint ?? "")}</p>
    <div class="upg-drop" data-drop="choice">
      <i class="fa-solid fa-hand-pointer"></i>
      <div class="upg-drop-text">
        <strong>${t("UPGRADES.Choice.DragHere")}</strong>
        <span>${t("UPGRADES.Choice.DragHint")}</span>
      </div>
    </div>`;

  const result = await DialogV2.wait({
    window: { title: label || t("UPGRADES.Buyer.Choose") },
    classes: ["upgrades"],
    content,
    buttons: [
      { action: "ok", label: t("UPGRADES.Choice.Confirm"), default: true, callback: () => picked },
      { action: "cancel", label: t("UPGRADES.Common.Cancel"), callback: () => null }
    ],
    render: (_event, dialog) => {
      const root = dialog.element ?? dialog;
      const zone = root.querySelector('[data-drop="choice"]');
      const ok = root.querySelector('[data-action="ok"]');
      if (ok) ok.disabled = true;   // nothing to confirm until something is dropped

      wireDropZone(zone, {
        accept,
        onDrop: doc => {
          // The caller may have a rule the drop kind alone cannot express — "carried by
          // somebody", say. Refused loudly here, while the buyer can still fix it.
          const objection = validate?.(doc);
          if (objection) return ui.notifications.warn(objection);
          picked = { uuid: doc.uuid, name: doc.name, img: doc.img ?? "" };
          zone.classList.add("filled");
          zone.innerHTML = `
            ${doc.img ? `<img src="${foundry.utils.escapeHTML(doc.img)}" alt="">` : ""}
            <div class="upg-drop-text">
              <strong>${foundry.utils.escapeHTML(doc.name)}</strong>
              <span>${foundry.utils.escapeHTML(doc.type ?? doc.documentName ?? "")}</span>
            </div>`;
          if (ok) ok.disabled = false;
        }
      });
    },
    rejectClose: false
  }).catch(() => null);

  return result ?? null;
}
