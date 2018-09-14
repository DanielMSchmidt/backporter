#!/usr/bin/env node
"use strict";

const cmd = require("node-cmd");
const inquirer = require("inquirer");

const BRANCHES = ["master", "release/1.11", "release/1.10", "release/1.9"];

function gatherInputs() {
  return inquirer.prompt([
    {
      type: "list",
      name: "currentBase",
      message: "Which branch are you based on?",
      choices: BRANCHES
    },
    {
      type: "checkbox",
      name: "targets",
      message: "Which branches should we port to?",
      choices: BRANCHES
    }
  ]);
}

function getShas(baseBranch) {
  return new Promise((resolve, reject) =>
    cmd.get(
      `
      git log ${baseBranch}..HEAD
    `,
      (err, data) => {
        if (err) {
          reject(err);
        }
        const lines = data.split("\n");
        const shas = lines
          .filter(line => line.includes("commit "))
          .map(line => line.replace("commit ", ""));

        resolve(shas);
      }
    )
  );
}

function createBackportBranch(currentBranch, target) {
  return new Promise((resolve, reject) => {
    const newBranch = `${target}-${currentBranch}`;
    cmd.get(
      `
            git checkout ${target}
            git pull origin ${target} --rebase
            git checkout -b ${target}-${currentBranch}
            `,
      err => {
        if (err) {
          reject(err);
        } else {
          resolve(newBranch);
        }
      }
    );
  });
}

function cherryPick(sha) {
  return new Promise((resolve, reject) =>
    cmd.get(
      `
      git cherry-pick ${sha}
      `,
      err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    )
  );
}

function getCurrentBranch() {
  return new Promise((resolve, reject) =>
    cmd.get(
      `
      git symbolic-ref --short HEAD
    `,
      (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data.replace("\n", ""));
        }
      }
    )
  );
}

function waitForUserToCleanUp() {
  return new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: "list",
          name: "shouldContinue",
          message: "Do you want to continue?",
          choices: ["Yes", "No"]
        }
      ])
      .then(({ shouldContinue }) => {
        if (shouldContinue === "Yes") {
          resolve();
        } else {
          reject();
        }
      });
  });
}

(async function() {
  const { currentBase, targets } = await gatherInputs();
  const shas = await getShas(currentBase);
  const currentBranch = await getCurrentBranch();

  for (let target of targets) {
    const newBranchName = await createBackportBranch(currentBranch, target);

    for (let sha of shas) {
      try {
        await cherryPick(sha);
      } catch (e) {
        console.error("There was an error cherry-picking", sha);
        console.error("Please fix it manually and continue the rebase.");
        try {
          await waitForUserToCleanUp();
        } catch (e) {
          console.log("You choose to not go forward with this, aborting...");
          process.exit(1);
        }
      }
    }

    console.log("Created backport for", newBranchName);
    console.log("Please push and and make the adjustments you need to do");
  }
})();
