import React, { useState } from "react";

export type DonationTier = {
  tierId: string;
  name: string;
  monthlyTotal: number;
  amount: number;
};

const MAX_PRESETS = 8;
