/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

import type { ILocalFile } from "@zowe/cics-for-zowe-explorer-api";
import { closeLocalFile } from "@zowe/cics-for-zowe-sdk";
import { ProgressLocation, type TreeView, commands, l10n, window } from "vscode";
import constants from "../constants/CICS.defaults";
import { LocalFileMeta } from "../doc";
import { CICSErrorHandler } from "../errors/CICSErrorHandler";
import { SessionHandler } from "../resources";
import type { CICSTree } from "../trees/CICSTree";
import type { CICSResourceContainerNode } from "../trees/CICSResourceContainerNode";
import { findSelectedNodes } from "../utils/commandUtils";
import { evaluateTreeNodes } from "../utils/treeUtils";

/**
 * Registers the command to close CICS local files from the VS Code tree view
 * @param tree - The CICS tree to refresh after closing
 * @param treeview - The tree view containing selected nodes
 * @returns Disposable command registration
 */
export function getCloseLocalFileCommand(tree: CICSTree, treeview: TreeView<any>) {
  return commands.registerCommand("cics-extension-for-zowe.closeLocalFile", async (clickedNode) => {
    const nodes = findSelectedNodes(treeview, LocalFileMeta, clickedNode);
    if (!nodes || !nodes.length) {
      window.showErrorMessage(l10n.t("No CICS local file selected"));
      return;
    }

    const busyChoices: Record<string, string> = {
      [l10n.t("Wait")]: "WAIT",
      [l10n.t("No Wait")]: "NOWAIT",
      [l10n.t("Force")]: "FORCE",
    };

    const selectedBusyOption = await window.showInformationMessage(
      l10n.t("Choose one of the following for the file busy condition"),
      ...Object.keys(busyChoices)
    );
    if (!selectedBusyOption) {
      return;
    }

    const busyDecision = busyChoices[selectedBusyOption];

    await window.withProgress(
      {
        title: l10n.t("Closing"),
        location: ProgressLocation.Notification,
        cancellable: false,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {});

        const nodesToRefresh = new Set();
        const errors: Array<{ node: CICSResourceContainerNode<ILocalFile>; error: any }> = [];

        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i] as CICSResourceContainerNode<ILocalFile>;
          progress.report({
            message: l10n.t("{0} of {1}", i + 1, nodes.length),
            increment: (1 / nodes.length) * constants.PERCENTAGE_MAX,
          });

          try {
            const profile = SessionHandler.getInstance().getProfile(node.getProfileName());
            const session = SessionHandler.getInstance().getSession(profile);

            const response = await closeLocalFile(session, {
              name: node.getContainedResource().resource.attributes.file,
              regionName: node.regionName ?? node.getContainedResource().resource.attributes.eyu_cicsname,
              cicsPlex: node.cicsplexName,
              busy: busyDecision,
            });

            nodesToRefresh.add(node.getParent());
            evaluateTreeNodes(node, response, node.getContainedResource().meta);
          } catch (error) {
            errors.push({ node, error });
            CICSErrorHandler.handleCMCIRestError(error);
          }
        }

        nodesToRefresh.forEach((v) => {
          tree.refresh(v);
        });

        // Show summary if there were any errors
        if (errors.length > 0) {
          const successCount = nodes.length - errors.length;
          const errorMessage =
            errors.length === nodes.length
              ? l10n.t("Failed to close all {0} local file(s)", nodes.length)
              : l10n.t("Closed {0} of {1} local file(s). {2} failed.", successCount, nodes.length, errors.length);
          window.showWarningMessage(errorMessage);
        }
      }
    );
  });
}
