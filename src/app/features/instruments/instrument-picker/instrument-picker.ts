import { Component, computed, effect, forwardRef, inject, input, model, signal, untracked } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { searchInstruments } from '../instrument-search';
import { INSTRUMENT_TYPE_LABELS } from '../instrument-types';
import { Instrument, InstrumentsService } from '../instruments.service';

// Parents own loading: they call InstrumentsService.ensureLoaded() and handle its
// error state; the picker only reads the cached signal.
@Component({
  selector: 'app-instrument-picker',
  imports: [MatFormFieldModule, MatSelectModule, MatInputModule, MatAutocompleteModule, MatButtonModule, MatIconModule],
  templateUrl: './instrument-picker.html',
  styleUrl: './instrument-picker.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => InstrumentPicker), multi: true }],
})
export class InstrumentPicker implements ControlValueAccessor {
  private readonly instrumentsService = inject(InstrumentsService);

  // '' means "nothing selected" / "all types".
  readonly ticker = model('');
  readonly type = model('');
  readonly disabled = input(false);

  protected readonly text = signal('');
  protected readonly touched = signal(false);
  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  protected readonly types = computed(() =>
    [...this.instrumentsService.types()].sort((a, b) => this.typeLabel(a).localeCompare(this.typeLabel(b))),
  );
  protected readonly options = computed(() =>
    // With a selection the field shows its label; offer the full list again instead
    // of filtering by that label.
    searchInstruments(this.instrumentsService.instruments(), this.ticker() ? '' : this.text(), this.type()),
  );
  protected readonly showInvalidHint = computed(() => this.touched() && !this.ticker() && this.text().trim() !== '');

  // Ticker whose label is currently shown in the text field ('' when the field holds
  // free-typed text). Lets the sync effect tell "selection cleared from outside"
  // (wipe the label) from "user is typing after a selection" (leave the text alone).
  private shownTicker = '';
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    effect(() => {
      const ticker = this.ticker();
      const instruments = this.instrumentsService.instruments();
      untracked(() => {
        if (ticker) {
          const instrument = instruments.find((i) => i.ticker === ticker);
          if (instrument) {
            this.text.set(this.label(instrument));
            this.shownTicker = ticker;
          }
        } else if (this.shownTicker) {
          this.text.set('');
          this.shownTicker = '';
        }
      });
    });
  }

  protected displayWith = (ticker: string): string => {
    const instrument = this.instrumentsService.instruments().find((i) => i.ticker === ticker);
    return instrument ? this.label(instrument) : ticker;
  };

  protected typeLabel(type: string): string {
    return INSTRUMENT_TYPE_LABELS[type] ?? type;
  }

  protected label(instrument: Instrument): string {
    return `${instrument.ticker} — ${instrument.name}`;
  }

  protected onTypeChange(type: string): void {
    this.type.set(type);
    const selected = this.instrumentsService.instruments().find((i) => i.ticker === this.ticker());
    if (type && selected && selected.type !== type) this.setTicker('');
  }

  protected onInput(value: string): void {
    this.text.set(value);
    if (this.ticker()) {
      this.shownTicker = '';
      this.setTicker('');
    }
  }

  protected onOptionSelected(ticker: string): void {
    this.setTicker(ticker);
  }

  protected onBlur(): void {
    this.touched.set(true);
    this.onTouched();
  }

  protected clear(): void {
    this.text.set('');
    this.shownTicker = '';
    this.touched.set(false);
    this.setTicker('');
  }

  private setTicker(ticker: string): void {
    this.ticker.set(ticker);
    this.onChange(ticker);
  }

  writeValue(value: string | null): void {
    this.ticker.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.cvaDisabled.set(disabled);
  }
}
