-- Restores the RSI-eligibility enforcement dropped when 0008_instrument_registry.sql
-- rebuilt alerts/market_data. Unlike the old CHECK (hardcoded to 'VIX'), these triggers
-- consult instruments.rsi_eligible dynamically, so a future non-RSI-eligible instrument
-- is protected automatically without another migration. Additive-only: no existing rows
-- are touched.

CREATE TRIGGER trg_alerts_rsi_eligibility_insert
BEFORE INSERT ON alerts
WHEN NEW.alert_type = 'RSI'
     AND (SELECT rsi_eligible FROM instruments WHERE ticker = NEW.ticker) = 0
BEGIN
  SELECT RAISE(FAIL, 'RSI not eligible for this ticker');
END;

CREATE TRIGGER trg_alerts_rsi_eligibility_update
BEFORE UPDATE ON alerts
WHEN NEW.alert_type = 'RSI'
     AND (SELECT rsi_eligible FROM instruments WHERE ticker = NEW.ticker) = 0
BEGIN
  SELECT RAISE(FAIL, 'RSI not eligible for this ticker');
END;

CREATE TRIGGER trg_market_data_rsi_eligibility_insert
BEFORE INSERT ON market_data
WHEN NEW.rsi IS NOT NULL
     AND (SELECT rsi_eligible FROM instruments WHERE ticker = NEW.ticker) = 0
BEGIN
  SELECT RAISE(FAIL, 'RSI not eligible for this ticker');
END;

CREATE TRIGGER trg_market_data_rsi_eligibility_update
BEFORE UPDATE ON market_data
WHEN NEW.rsi IS NOT NULL
     AND (SELECT rsi_eligible FROM instruments WHERE ticker = NEW.ticker) = 0
BEGIN
  SELECT RAISE(FAIL, 'RSI not eligible for this ticker');
END;
