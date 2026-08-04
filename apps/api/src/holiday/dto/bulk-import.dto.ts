import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';

import { CreateHolidayDto } from './create-holiday.dto';

export class BulkImportHolidaysDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Minimal 1 hari libur' })
  @ArrayMaxSize(500, { message: 'Maksimum 500 hari libur per bulk import' })
  @ValidateNested({ each: true })
  @Type(() => CreateHolidayDto)
  items!: CreateHolidayDto[];
}
