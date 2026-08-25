import { Module } from '@nestjs/common'
import { ImportCommand } from './commands/import.command.js'
import { CheckCommand } from './commands/check.command.js'

@Module({ providers: [ImportCommand, CheckCommand] })
export class AppModule {}
