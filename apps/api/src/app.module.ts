import { Module } from '@nestjs/common'
import { ImportCommand } from './commands/import.command.js'
import { CheckCommand } from './commands/check.command.js'
import { ResolveCommand } from './commands/resolve.command.js'

@Module({ providers: [ImportCommand, CheckCommand, ResolveCommand] })
export class AppModule {}
