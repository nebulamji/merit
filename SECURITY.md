# Security policy

Merit handles signing keys and personal process data, so security reports matter.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting: go to the **Security** tab of this repository and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what it could affect.

We will acknowledge a report promptly, work on a fix, and credit you in the release notes if you wish.

## Scope

In scope: the attestation format and verifier, the signing and key handling in the desktop app, the capture pipeline (anything that could leak what is typed), and the Book's inscription rules.

Out of scope: social engineering, and attacks that require physical access to an unlocked machine you already control.

## What we will never do

Store or transmit raw keystrokes, or hold your private key. If you find a way Merit does either, that is a vulnerability and we want to hear about it.
